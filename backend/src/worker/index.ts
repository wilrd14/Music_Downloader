import fs from 'node:fs';
import path from 'node:path';
import {
  claimNextJob,
  config,
  finishJob,
  findExpiredJobIds,
  markExpired,
  recoverInterruptedJobs,
  type JobRow,
} from '../core';
import { getResolver } from '../resolvers';
import { limits, purgeOldJobs } from '../core';
import { runJob, Semaphore } from './runner';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args);

let running = 0;
/** Tope global de yt-dlp+ffmpeg simultáneos entre todos los trabajos. */
const downloadSlots = new Semaphore(config.maxParallelDownloads);

async function processJob(job: JobRow): Promise<void> {
  await runJob(job, { resolver: getResolver(job.provider), semaphore: downloadSlots });
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

function cleanup() {
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
  // Minimización de datos: las filas de trabajos terminados se borran pasadas 24 h.
  try {
    const purged = purgeOldJobs(limits.jobRowRetentionMs);
    if (purged) log(`${purged} trabajo(s) antiguo(s) borrado(s) de la base de datos`);
  } catch (err) {
    console.error('purga de trabajos antiguos falló', err);
  }
}

const recovered = recoverInterruptedJobs();
if (recovered) log(`${recovered} trabajo(s) reencolado(s) tras reinicio`);
fs.mkdirSync(config.jobsDir, { recursive: true });
cleanup();

setInterval(tick, 1000);
setInterval(cleanup, 60_000);
log(`listo (trabajos ${config.workerConcurrency}, pistas por trabajo ${config.trackConcurrency}, descargas simultáneas máx. ${config.maxParallelDownloads})`);
