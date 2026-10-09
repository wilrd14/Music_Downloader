import fs from 'node:fs';
import path from 'node:path';
import {
  claimNextJob,
  config,
  finishJob,
  findExpiredJobIds,
  jobOutDir,
  limits,
  markExpired,
  purgeOldJobs,
  recoverInterruptedJobs,
  resolveDownloadDir,
  setJobSavedTo,
  type AppMode,
  type JobRow,
} from '../core';
import { getResolver } from '../resolvers';
import { runJob, Semaphore } from './runner';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args);

export interface WorkerHandle {
  /** Detiene los temporizadores; los trabajos en curso terminan por su cuenta. */
  stop(): void;
}

export interface WorkerOptions {
  /** Por defecto `config.mode`. */
  mode?: AppMode;
}

/**
 * Limpieza periódica.
 * - Modo servidor: borra las carpetas temporales de trabajos terminados pasado el TTL.
 * - Modo local: NUNCA borra archivos (son de la persona); solo se purgan filas antiguas de la base de datos.
 */
export function cleanup(mode: AppMode = config.mode): void {
  if (mode === 'server') {
    let ids: string[];
    try {
      ids = findExpiredJobIds(config.jobTtlMs);
    } catch (err) {
      console.error('cleanup falló', err);
      return;
    }
    for (const id of ids) {
      try {
        // En Windows el borrado falla (EBUSY/EPERM) si un archivo se está sirviendo; se reintenta en el próximo ciclo.
        fs.rmSync(path.join(config.jobsDir, id), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        markExpired(id);
        log(`job ${id} expirado y archivos eliminados`);
      } catch (err) {
        console.error(`no se pudo expirar el job ${id}`, err);
      }
    }
  }
  // Minimización de datos: las filas de trabajos terminados se borran pasadas 24 h.
  try {
    const purged = purgeOldJobs(limits.jobRowRetentionMs);
    if (purged) log(`${purged} trabajo(s) antiguo(s) borrado(s) de la base de datos`);
  } catch (err) {
    console.error('purga de trabajos antiguos falló', err);
  }
}

/** Arranca el bucle del worker en este proceso. Lo usan `npm run start:worker` (proceso aparte) y el modo local. */
export function startWorker(options: WorkerOptions = {}): WorkerHandle {
  const mode = options.mode ?? config.mode;
  let running = 0;
  /** Tope global de yt-dlp+ffmpeg simultáneos entre todos los trabajos. */
  const downloadSlots = new Semaphore(config.maxParallelDownloads);

  async function processJob(job: JobRow): Promise<void> {
    const resolver = getResolver(job.provider);
    if (mode === 'local') {
      // La carpeta se lee al empezar cada trabajo: un cambio de ajuste afecta a los trabajos nuevos.
      const downloadDir = resolveDownloadDir();
      await runJob(job, {
        resolver,
        semaphore: downloadSlots,
        outDir: (j) => jobOutDir(downloadDir, j),
        uniqueNames: true,
        setSavedTo: setJobSavedTo,
      });
    } else {
      await runJob(job, { resolver, semaphore: downloadSlots });
    }
  }

  function tick() {
    while (running < config.workerConcurrency) {
      let job;
      try {
        job = claimNextJob();
      } catch (err) {
        console.error('no se pudo tomar un trabajo de la cola', err);
        return;
      }
      if (!job) return;
      running++;
      processJob(job)
        .catch((err) => {
          console.error(`job ${job.id} falló`, err);
          try {
            finishJob(job.id, 'failed', 'Error interno al procesar el trabajo.');
          } catch (e) {
            console.error(e);
          }
        })
        .finally(() => {
          running--;
        });
    }
  }

  const recovered = recoverInterruptedJobs();
  if (recovered) log(`${recovered} trabajo(s) reencolado(s) tras reinicio`);
  if (mode === 'server') fs.mkdirSync(config.jobsDir, { recursive: true });
  cleanup(mode);

  const tickTimer = setInterval(tick, 1000);
  const cleanupTimer = setInterval(() => cleanup(mode), 60_000);
  log(
    `listo (modo ${mode}, trabajos ${config.workerConcurrency}, pistas por trabajo ${config.trackConcurrency}, descargas simultáneas máx. ${config.maxParallelDownloads})`,
  );
  return {
    stop() {
      clearInterval(tickTimer);
      clearInterval(cleanupTimer);
    },
  };
}
