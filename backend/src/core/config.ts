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
  /** Carpeta de la interfaz compilada (frontend/dist). Si no existe, solo se sirve la API. */
  staticDir: process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.resolve(root, '../frontend/dist'),
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

// ---------------------------------------------------------------------------
// Límites por IP, topes de cola/disco y Cloudflare Turnstile (apertura al público).
// Bloque independiente: ver docs/security.md.
// ---------------------------------------------------------------------------
export const limits = {
  /** Ventana de los límites de peticiones. */
  rateWindowMs: 60_000,
  /** Peticiones por minuto y por IP a cualquier /api/* (salvo las que tienen límite propio). */
  rateGeneralPerMin: num(process.env.RATE_LIMIT_GENERAL_PER_MIN, 120),
  rateResolvePerMin: num(process.env.RATE_LIMIT_RESOLVE_PER_MIN, 20),
  rateJobsPerMin: num(process.env.RATE_LIMIT_JOBS_PER_MIN, 6),
  rateDownloadPerMin: num(process.env.RATE_LIMIT_DOWNLOAD_PER_MIN, 30),
  /** Trabajos en cola (global). */
  maxQueuedJobs: num(process.env.MAX_QUEUED_JOBS, 30),
  /** Trabajos en cola o ejecutándose por IP. */
  maxActiveJobsPerIp: num(process.env.MAX_ACTIVE_JOBS_PER_IP, 2),
  /** Tamaño máximo de data/jobs; se rechazan trabajos nuevos al alcanzarlo. */
  maxDiskBytes: num(process.env.MAX_DISK_MB, 4096) * 1024 * 1024,
  /** Las filas de trabajos terminados se borran pasado este tiempo (minimizar datos). */
  jobRowRetentionMs: 24 * 60 * 60_000,
  /** Cloudflare Turnstile: sin clave secreta no se verifica (modo desarrollo). */
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || null,
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
};

export type Limits = typeof limits;
