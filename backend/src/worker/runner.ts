import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  finishJob,
  getTrackRows,
  reserveFileBase,
  sanitizeFileName,
  updateTrack,
  UserError,
  type JobRow,
  type Resolver,
  type TrackRow,
} from '../core';

/** Semáforo con cola FIFO: limita cuántas tareas corren a la vez. */
export class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('El límite del semáforo debe ser un entero >= 1.');
  }

  get inUse(): number {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    // Si había cola, el hueco se traspasa directamente al siguiente (active no cambia).
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Reintenta una vez: la mayoría de fallos sueltos son cortes de red momentáneos. */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 2000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Dependencias inyectables para poder probar el runner sin red ni yt-dlp. */
export interface RunnerDeps {
  resolver: Resolver;
  /** Tope global de descargas simultáneas entre todos los trabajos. */
  semaphore: Semaphore;
  /** Pistas de este trabajo que se procesan a la vez (por defecto TRACK_CONCURRENCY). */
  trackConcurrency?: number;
  /**
   * Carpeta de salida, decidida por quien llama (por defecto data/jobs/<id>/tracks, modo servidor).
   * En modo local es la carpeta de música (o su subcarpeta de playlist); puede ser una función del trabajo.
   */
  outDir?: string | ((job: JobRow) => string);
  /** Modo local: nunca sobrescribir; si el archivo existe se añade " (1)", " (2)"... antes de la extensión. */
  uniqueNames?: boolean;
  /** Modo local: se invoca al empezar con la carpeta donde quedarán los archivos (se guarda como `savedTo`). */
  setSavedTo?: (jobId: string, dir: string) => void;
  retryDelayMs?: number;
  /** Mínimo entre escrituras de progreso de una misma pista. */
  progressThrottleMs?: number;
  getTrackRows?: (jobId: string) => TrackRow[];
  updateTrack?: typeof updateTrack;
  finishJob?: typeof finishJob;
  log?: (...args: unknown[]) => void;
}

export interface JobResult {
  ok: number;
  total: number;
}

const defaultLog = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args);

/**
 * Procesa las pistas de un trabajo con un pool de `trackConcurrency` y respeta el semáforo global.
 * Un fallo en una pista no detiene a las demás. El trabajo queda `done` si al menos una pista salió bien.
 */
export async function runJob(job: JobRow, deps: RunnerDeps): Promise<JobResult> {
  const {
    resolver,
    semaphore,
    getTrackRows: readTracks = getTrackRows,
    updateTrack: writeTrack = updateTrack,
    finishJob: closeJob = finishJob,
    log = defaultLog,
    retryDelayMs = 2000,
    progressThrottleMs = 400,
  } = deps;
  const concurrency = Math.max(1, Math.floor(deps.trackConcurrency ?? config.trackConcurrency));

  log(`job ${job.id} iniciado (${job.title})`);
  let outDir: string;
  try {
    outDir =
      typeof deps.outDir === 'function' ? deps.outDir(job) : (deps.outDir ?? path.join(config.jobsDir, job.id, 'tracks'));
    fs.mkdirSync(outDir, { recursive: true });
    deps.setSavedTo?.(job.id, outDir);
  } catch (err) {
    console.error(err);
    closeJob(job.id, 'failed', 'No se pudo preparar la carpeta de destino.');
    return { ok: 0, total: readTracks(job.id).length };
  }
  const tracks = readTracks(job.id);
  const pad = String(tracks.length).length;
  let ok = tracks.filter((t) => t.status === 'done').length;
  const pending = tracks.filter((t) => t.status !== 'done');

  async function processTrack(row: TrackRow): Promise<void> {
    const name = sanitizeFileName(`${row.artist} - ${row.title}`);
    const wanted = job.kind === 'playlist' ? `${String(row.idx + 1).padStart(pad, '0')} - ${name}` : name;
    const label = `job ${job.id} pista ${row.idx + 1}/${tracks.length}`;
    // Modo local: el nombre se reserva antes de descargar para no pisar archivos existentes ni a otra pista en curso.
    const reservation = deps.uniqueNames ? reserveFileBase(outDir, wanted, job.format) : null;
    const fileBase = reservation?.fileBase ?? wanted;

    let lastWrite = 0;
    let startedAt = 0;
    try {
      const file = await withRetry(
        () =>
          // El hueco global se pide por intento: durante la espera del reintento no se ocupa.
          semaphore.run(async () => {
            startedAt ||= Date.now();
            writeTrack(job.id, row.idx, { status: 'downloading', progress: 0, error: null });
            lastWrite = 0;
            return resolver.download(
              {
                id: row.track_id,
                title: row.title,
                artist: row.artist,
                durationSec: row.duration_sec,
                thumbnail: row.thumbnail,
                url: row.url,
              },
              {
                outDir,
                fileBase,
                format: job.format,
                onProgress(percent, phase) {
                  const now = Date.now();
                  if (now - lastWrite < progressThrottleMs && percent < 100) return;
                  lastWrite = now;
                  writeTrack(job.id, row.idx, {
                    status: phase === 'converting' ? 'converting' : 'downloading',
                    progress: percent,
                  });
                },
              },
            );
          }),
        1,
        retryDelayMs,
      );
      writeTrack(job.id, row.idx, { status: 'done', progress: 100, file_path: file });
      ok++;
      log(`${label} lista en ${Date.now() - startedAt} ms`);
    } catch (err) {
      const message = err instanceof UserError ? err.message : 'Error inesperado al descargar esta pista.';
      if (!(err instanceof UserError)) console.error(err);
      try {
        writeTrack(job.id, row.idx, { status: 'failed', progress: 0, error: message });
      } catch (e) {
        console.error(e);
      }
      log(`${label} falló en ${startedAt ? Date.now() - startedAt : 0} ms: ${message}`);
    } finally {
      reservation?.release();
    }
  }

  // Pool: cada "carril" toma la siguiente pista pendiente hasta vaciar la lista.
  let next = 0;
  const lane = async () => {
    while (next < pending.length) await processTrack(pending[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, lane));

  if (ok > 0) closeJob(job.id, 'done');
  else closeJob(job.id, 'failed', 'No se pudo descargar ninguna pista.');
  log(`job ${job.id} terminado: ${ok}/${tracks.length} pistas`);
  return { ok, total: tracks.length };
}
