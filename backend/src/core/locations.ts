import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config';
import { UserError } from './errors';
import { sanitizeFileName } from './files';
import { defaultMusicDir, isInside } from './platform';
import { readSettings } from './settings';
import type { SourceKind } from './types';

export { isInside };

// ---------------------------------------------------------------------------
// Regla de validación de la carpeta de música (PUT /api/settings). Documentada en docs/security.md.
//
// Una ruta es aceptable si, tras normalizarla (`path.resolve`, que colapsa `..` y separadores sobrantes):
//   1. es una cadena no vacía de hasta 1024 caracteres, sin NUL ni caracteres de control;
//   2. es absoluta de verdad: en Windows empieza por unidad + separador (`C:\...`; se rechazan rutas
//      relativas, sin unidad como `\x`, `C:x`, UNC `\\servidor\recurso` y prefijos `\\?\` / `\\.\`);
//      en macOS/Linux empieza por `/` (no se expande `~`);
//   3. no es la raíz del sistema de archivos (`/`, `C:\`);
//   4. no es la carpeta personal (home) ni un contenedor de cuentas (`C:\Users`, `/home`, `/Users`...)
//      ni cuelga de un directorio del sistema: Windows (`Windows`, `Program Files`, `Program Files (x86)`,
//      `ProgramData`, `$Recycle.Bin`, `System Volume Information`, `Recovery`, `Boot`), Linux (`/bin /boot /dev
//      /etc /lib* /proc /root /run /sbin /sys /usr /snap /var/{lib,log,run,spool,cache,mail,db}`) y macOS
//      (`/System /Library /Applications /cores /private/etc`, además de lo anterior);
//   5. se puede crear (mkdir -p) y se puede escribir en ella (se crea y borra un archivo de prueba);
//   6. su ruta real (tras resolver enlaces simbólicos) también supera los puntos 3 y 4.
// ---------------------------------------------------------------------------

const MAX_PATH_LENGTH = 1024;

const WIN_SYSTEM_TREES = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information|recovery|boot)(\\|$)/;
const WIN_ACCOUNT_CONTAINER = /^[a-z]:\\users$/;
const POSIX_SYSTEM_TREES = [
  '/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/libx32', '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/snap',
  '/var/lib', '/var/log', '/var/run', '/var/spool', '/var/cache', '/var/mail', '/var/db', '/var/root',
  '/system', '/library', '/applications', '/cores', '/private/etc', '/private/var/db', '/private/var/root',
];
// Carpetas que solo se rechazan tal cual (sí valen sus subcarpetas): contenedores de cuentas, montajes y temporales.
const POSIX_ACCOUNT_CONTAINERS = ['/home', '/users', '/mnt', '/media', '/volumes', '/tmp', '/opt', '/srv', '/var', '/private', '/private/var'];

export type ShapeResult = { ok: true; dir: string } | { ok: false; error: string };

const fail = (error: string): ShapeResult => ({ ok: false, error });

/** Parte pura de la validación (puntos 1 a 4): no toca el disco, así que se prueba igual en cualquier sistema. */
export function checkDownloadDirShape(
  raw: unknown,
  opts: { platform?: NodeJS.Platform; home?: string } = {},
): ShapeResult {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;

  if (typeof raw !== 'string') return fail('Indica la carpeta como texto.');
  const text = raw.trim();
  if (!text) return fail('Indica una carpeta.');
  if (text.length > MAX_PATH_LENGTH) return fail('La ruta es demasiado larga.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(text)) return fail('La ruta contiene caracteres no válidos.');

  if (win ? !/^[A-Za-z]:[\\/]/.test(text) : !text.startsWith('/')) {
    return fail(
      win
        ? 'Usa una ruta completa que empiece por la unidad, por ejemplo C:\\Users\\tu-nombre\\Music\\tunedrop. No se admiten rutas relativas ni de red (\\\\servidor).'
        : 'Usa una ruta completa que empiece por "/", por ejemplo /home/tu-nombre/Music/tunedrop.',
    );
  }

  const dir = p.resolve(text);
  if (p.parse(dir).root === dir) return fail('No puedes usar la raíz del disco como carpeta de música.');

  const norm = dir.toLowerCase(); // Windows y macOS no distinguen mayúsculas; denegar de más en Linux es inocuo
  if (norm === p.resolve(home).toLowerCase()) {
    return fail('Elige una subcarpeta (por ejemplo Música\\tunedrop), no tu carpeta personal completa.');
  }
  const dangerous = win
    ? WIN_SYSTEM_TREES.test(norm) || WIN_ACCOUNT_CONTAINER.test(norm)
    : POSIX_SYSTEM_TREES.some((t) => norm === t || norm.startsWith(`${t}/`)) || POSIX_ACCOUNT_CONTAINERS.includes(norm);
  if (dangerous) return fail('Esa carpeta es del sistema. Elige una carpeta propia, por ejemplo dentro de tu carpeta de Música.');

  return { ok: true, dir };
}

/**
 * Valida la carpeta elegida, la crea si no existe y comprueba que se puede escribir.
 * Devuelve la ruta normalizada o lanza `UserError` (400) con un mensaje en español.
 */
export function validateDownloadDir(raw: unknown, opts: { platform?: NodeJS.Platform; home?: string } = {}): string {
  const shape = checkDownloadDirShape(raw, opts);
  if (!shape.ok) throw new UserError(shape.error, 400);
  const dir = shape.dir;

  try {
    if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) throw new UserError('Esa ruta es un archivo, no una carpeta.', 400);
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError('No se pudo crear la carpeta. Revisa la ruta y los permisos.', 400);
  }

  // Los enlaces simbólicos no deben llevar a un sitio prohibido.
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    throw new UserError('No se pudo comprobar la carpeta.', 400);
  }
  const realShape = checkDownloadDirShape(real.replace(/^\\\\\?\\/, ''), opts);
  if (!realShape.ok) throw new UserError(realShape.error, 400);

  const probe = path.join(dir, `.tunedrop-escritura-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
  } catch {
    throw new UserError('No se puede escribir en esa carpeta. Elige otra o revisa los permisos.', 400);
  }
  return dir;
}

/** Carpeta de música efectiva: ajuste guardado, si no `DOWNLOAD_DIR`, si no `<home>/Music/tunedrop`. */
export function resolveDownloadDir(
  opts: { dataDir?: string; envDir?: string | null; platform?: NodeJS.Platform; home?: string } = {},
): string {
  const { dataDir = config.dataDir, envDir = config.downloadDirEnv, ...rest } = opts;
  for (const candidate of [readSettings(dataDir).downloadDir, envDir]) {
    const shape = candidate ? checkDownloadDirShape(candidate, rest) : null;
    if (shape?.ok) return shape.dir;
  }
  return defaultMusicDir(rest);
}

/** Carpeta de destino de un trabajo: la música a secas para una pista, subcarpeta con el título para una playlist. */
export function jobOutDir(downloadDir: string, job: { kind: SourceKind; title: string }): string {
  const dir = job.kind === 'playlist' ? path.join(downloadDir, sanitizeFileName(job.title)) : downloadDir;
  if (!isInside(downloadDir, dir, true)) throw new UserError('Carpeta de destino no válida.', 400);
  return dir;
}
