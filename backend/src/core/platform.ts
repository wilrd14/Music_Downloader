import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Utilidades puras (sin importar la configuración) para el modo local: carpetas por defecto
 * según el sistema operativo y búsqueda de los binarios yt-dlp / ffmpeg.
 */

export type AppMode = 'local' | 'server';

/** `TUNEDROP_MODE`: `local` (por defecto) o `server`. Cualquier otro valor es un error de configuración. */
export function parseMode(value: string | undefined): AppMode {
  const v = (value ?? '').trim().toLowerCase();
  if (!v || v === 'local') return 'local';
  if (v === 'server') return 'server';
  throw new Error(`TUNEDROP_MODE no válido: "${value}". Usa "local" o "server".`);
}

export interface PlatformEnv {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
}

/** Carpeta de datos de la app (base SQLite, settings.json) en modo local cuando no hay `DATA_DIR`. */
export function defaultLocalDataDir({ platform = process.platform, env = process.env, home = os.homedir() }: PlatformEnv = {}): string {
  if (platform === 'win32') {
    const p = path.win32;
    return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'tunedrop');
  }
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'tunedrop');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home, '.local', 'share'), 'tunedrop');
}

/** Carpeta de música por defecto: `<home>/Music/tunedrop`. */
export function defaultMusicDir({ platform = process.platform, home = os.homedir() }: PlatformEnv = {}): string {
  return (platform === 'win32' ? path.win32 : path.posix).join(home, 'Music', 'tunedrop');
}

// ---------------------------------------------------------------------------
// Binarios
// ---------------------------------------------------------------------------

export type BinaryName = 'yt-dlp' | 'ffmpeg';
export type BinarySource = 'bundled' | 'env' | 'path';

export interface FindBinaryOptions {
  /** Carpeta `bin` empaquetada con la app. */
  binDir: string;
  /** Valor de `YT_DLP_PATH` / `FFMPEG_PATH` (archivo o, para ffmpeg, carpeta). */
  envOverride?: string | null;
  platform?: NodeJS.Platform;
  isFile?: (p: string) => boolean;
}

export interface FoundBinary {
  /** Ruta absoluta o del override; `null` = usar el nombre a secas (se resuelve por PATH). */
  path: string | null;
  source: BinarySource;
}

const fileExists = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Orden de búsqueda: 1) carpeta `bin` empaquetada, 2) variable de entorno, 3) PATH. */
export function findBinary(name: BinaryName, opts: FindBinaryOptions): FoundBinary {
  const platform = opts.platform ?? process.platform;
  const isFile = opts.isFile ?? fileExists;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const bundled = p.join(opts.binDir, platform === 'win32' ? `${name}.exe` : name);
  if (isFile(bundled)) return { path: bundled, source: 'bundled' };
  const env = opts.envOverride?.trim();
  if (env) return { path: env, source: 'env' };
  return { path: null, source: 'path' };
}

/**
 * Carpeta de la interfaz compilada. `STATIC_DIR` manda; si no, la primera con `index.html` entre:
 * `<root>/web` (paquete de distribución), `<root>/../frontend/dist` (repo, root = backend)
 * y `<root>/../../frontend/dist` (bundle en backend/dist). Si no hay ninguna, devuelve la del repo.
 */
export function findStaticDir(root: string, override?: string | null, hasIndex: (dir: string) => boolean = (d) => fs.existsSync(path.join(d, 'index.html'))): string {
  if (override) return path.resolve(override);
  const candidates = [path.join(root, 'web'), path.resolve(root, '../frontend/dist'), path.resolve(root, '../../frontend/dist')];
  return candidates.find(hasIndex) ?? candidates[1]!;
}

/** True si `file` está dentro de `base` (o es `base`, con `allowEqual`). Compara rutas ya resueltas. */
export function isInside(base: string, file: string, allowEqual = false, platform: NodeJS.Platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(p.resolve(base), p.resolve(file));
  if (!rel) return allowEqual;
  return rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}
