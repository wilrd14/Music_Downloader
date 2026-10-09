import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLocalDataDir, findBinary, findStaticDir, parseMode } from './platform';

/** Carpeta del script en ejecución: `src/core` en desarrollo, la carpeta del bundle (`dist`) al empaquetar. */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const inSource = path.basename(scriptDir) === 'core' && path.basename(path.dirname(scriptDir)) === 'src';
/** Raíz de la app: la carpeta `backend` en desarrollo; la carpeta del script empaquetado (con `bin/` y `web/` al lado). */
const root = inSource ? path.resolve(scriptDir, '../..') : scriptDir;

// Las pruebas (node --test define NODE_TEST_CONTEXT) no deben depender de la configuración real de la máquina.
if (!process.env.NODE_TEST_CONTEXT) {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    // .env es opcional
  }
}

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const flag = (value: string | undefined, fallback: boolean) => {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  return !['0', 'false', 'no', 'off'].includes(v);
};

/** `local` (por defecto): cada persona ejecuta tunedrop en su PC y guarda en su carpeta de música. `server`: servicio público. */
const mode = parseMode(process.env.TUNEDROP_MODE);

// En modo local, sin DATA_DIR, los datos van a la carpeta de datos de aplicación del sistema; en modo servidor, a backend/data.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : mode === 'local'
    ? defaultLocalDataDir()
    : path.join(root, 'data');

/** Carpeta con yt-dlp / ffmpeg empaquetados junto a la app. */
const binDir = process.env.TUNEDROP_BIN_DIR ? path.resolve(process.env.TUNEDROP_BIN_DIR) : path.join(root, 'bin');
const ytDlp = findBinary('yt-dlp', { binDir, envOverride: process.env.YT_DLP_PATH });
const ffmpeg = findBinary('ffmpeg', { binDir, envOverride: process.env.FFMPEG_PATH });

export const config = {
  root,
  mode,
  dataDir,
  dbPath: path.join(dataDir, 'tunedrop.db'),
  jobsDir: path.join(dataDir, 'jobs'),
  /** Modo local: carpeta de música por defecto si no hay ajuste guardado (si no se define, `<home>/Music/tunedrop`). */
  downloadDirEnv: process.env.DOWNLOAD_DIR?.trim() || null,
  apiPort: num(process.env.API_PORT, 8787),
  /** Carpeta de la interfaz compilada (frontend/dist). Si no existe, solo se sirve la API. */
  staticDir: findStaticDir(root, process.env.STATIC_DIR),
  corsOrigin: process.env.CORS_ORIGIN ?? null,
  maxTracksPerJob: num(process.env.MAX_TRACKS_PER_JOB, 100),
  maxResolveEntries: 300,
  jobTtlMs: num(process.env.JOB_TTL_MINUTES, 30) * 60_000,
  /** Tiempo máximo por pista (descarga + conversión). */
  trackTimeoutMs: num(process.env.TRACK_TIMEOUT_MINUTES, 10) * 60_000,
  bodyLimitBytes: 16 * 1024,
  workerConcurrency: num(process.env.WORKER_CONCURRENCY, 2),
  // --- Paralelismo de pistas del worker ---
  /** Pistas de un mismo trabajo que se descargan a la vez. */
  trackConcurrency: Math.floor(num(process.env.TRACK_CONCURRENCY, 3)),
  /** Tope global de descargas simultáneas (yt-dlp + ffmpeg) sumando todos los trabajos. */
  maxParallelDownloads: Math.floor(num(process.env.MAX_PARALLEL_DOWNLOADS, 4)),
  // --- Fin del bloque de paralelismo ---
  /** Carpeta `bin` empaquetada (se busca primero aquí; ver `findBinary`). */
  binDir,
  ytDlpPath: ytDlp.path ?? 'yt-dlp',
  ytDlpSource: ytDlp.source,
  /** Carpeta o binario de ffmpeg; `null` = el del PATH. */
  ffmpegPath: ffmpeg.path,
  /** Modo local: actualizar el yt-dlp empaquetado como máximo una vez cada 24 h al arrancar. */
  ytDlpAutoUpdate: mode === 'local' && flag(process.env.YT_DLP_AUTO_UPDATE, true),
  /** Modo local: no abrir el navegador al arrancar. */
  noBrowser: flag(process.env.TUNEDROP_NO_BROWSER, false),
};

// ---------------------------------------------------------------------------
// Límites por IP, topes de cola/disco y Cloudflare Turnstile (apertura al público).
// Solo se aplican en modo servidor. Bloque independiente: ver docs/security.md.
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
export type { AppMode } from './platform';
