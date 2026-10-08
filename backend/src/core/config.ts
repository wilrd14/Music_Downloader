import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // .env es opcional
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');

export const config = {
  root,
  dataDir,
  dbPath: path.join(dataDir, 'tunedrop.db'),
  jobsDir: path.join(dataDir, 'jobs'),
  apiPort: num(process.env.API_PORT, 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? null,
  maxTracksPerJob: num(process.env.MAX_TRACKS_PER_JOB, 100),
  maxResolveEntries: 300,
  jobTtlMs: num(process.env.JOB_TTL_MINUTES, 30) * 60_000,
  /** Tiempo máximo por pista (descarga + conversión). */
  trackTimeoutMs: num(process.env.TRACK_TIMEOUT_MINUTES, 10) * 60_000,
  bodyLimitBytes: 16 * 1024,
  workerConcurrency: num(process.env.WORKER_CONCURRENCY, 2),
  ytDlpPath: process.env.YT_DLP_PATH || 'yt-dlp',
  /** Carpeta o binario de ffmpeg; si no se define se usa el del PATH. */
  ffmpegPath: process.env.FFMPEG_PATH || null,
};
