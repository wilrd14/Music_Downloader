import fs from 'node:fs';
import path from 'node:path';
import {
  claimNextJob,
  config,
  finishJob,
  findExpiredJobIds,
  getTrackRows,
  markExpired,
  recoverInterruptedJobs,
  sanitizeFileName,
  updateTrack,
  UserError,
  type JobRow,
} from '../core';
import { getResolver } from '../resolvers';

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args);

let running = 0;

async function processJob(job: JobRow): Promise<void> {
  log(`job ${job.id} iniciado (${job.title})`);
  const resolver = getResolver(job.provider);
  const outDir = path.join(config.jobsDir, job.id, 'tracks');
  const tracks = getTrackRows(job.id);
  const pad = String(tracks.length).length;
  let ok = 0;

  for (const row of tracks) {
    if (row.status === 'done') {
      ok++;
      continue;
    }
    updateTrack(job.id, row.idx, { status: 'downloading', progress: 0, error: null });

    const name = sanitizeFileName(`${row.artist} - ${row.title}`);
    const fileBase = job.kind === 'playlist' ? `${String(row.idx + 1).padStart(pad, '0')} - ${name}` : name;

    let lastWrite = 0;
    try {
      const file = await resolver.download(
        {
          id: row.track_id,
          title: row.title,
          artist: row.artist,
          durationSec: row.duration_sec,
          thumbnail: row.thumbnail,
          album: row.album,
          url: row.url,
        },
        {
          outDir,
          fileBase,
          format: job.format,
          onProgress(percent, phase) {
            const now = Date.now();
            if (now - lastWrite < 400 && percent < 100) return;
            lastWrite = now;
            updateTrack(job.id, row.idx, {
              status: phase === 'converting' ? 'converting' : 'downloading',
              progress: percent,
            });
          },
        },
      );
      updateTrack(job.id, row.idx, { status: 'done', progress: 100, file_path: file });
      ok++;
    } catch (err) {
      const message = err instanceof UserError ? err.message : 'Error inesperado al descargar esta pista.';
      if (!(err instanceof UserError)) console.error(err);
      updateTrack(job.id, row.idx, { status: 'failed', progress: 0, error: message });
    }
  }

  if (ok > 0) finishJob(job.id, 'done');
  else finishJob(job.id, 'failed', 'No se pudo descargar ninguna pista.');
  log(`job ${job.id} terminado: ${ok}/${tracks.length} pistas`);
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
}

const recovered = recoverInterruptedJobs();
if (recovered) log(`${recovered} trabajo(s) reencolado(s) tras reinicio`);
fs.mkdirSync(config.jobsDir, { recursive: true });
cleanup();

setInterval(tick, 1000);
setInterval(cleanup, 60_000);
log(`listo (concurrencia ${config.workerConcurrency})`);
