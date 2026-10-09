import fs from 'node:fs';
import path from 'node:path';

/** Rutas ya prometidas a otra pista en curso (dos descargas simultáneas no deben elegir el mismo nombre). */
const reserved = new Set<string>();

export interface Reservation {
  /** Nombre sin extensión, único en la carpeta. */
  fileBase: string;
  /** Libera la reserva (el archivo ya existe en disco o la pista falló). */
  release(): void;
}

const keyOf = (p: string) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

/**
 * Archivos que yt-dlp crea (y borra) junto al resultado con el mismo nombre base: el audio original antes de
 * convertirlo (`.webm`, `.m4a`, `.opus`...), la miniatura (`.jpg`, `.webp`...) y los parciales. Si ya existe
 * uno de la persona con ese nombre, yt-dlp lo da por «ya descargado», lo convierte y lo BORRA al terminar
 * (verificado con yt-dlp 2026.08.19: un `Tema.m4a` existente desaparece al bajar `Tema` como MP3).
 * Por eso un nombre base solo está libre si no existe ninguno de ellos (ni el archivo final).
 */
export const SIBLING_EXTENSIONS = [
  'webm', 'm4a', 'opus', 'ogg', 'weba', 'aac', 'flac', 'wav', 'mka', 'mp4', '3gp', 'mkv', 'mov',
  'jpg', 'jpeg', 'png', 'webp', 'part', 'ytdl', 'temp',
] as const;

/**
 * Elige `base`, o `base (1)`, `base (2)`... antes de la extensión, de modo que ni `<dir>/<nombre>.<ext>` ni un archivo
 * intermedio de yt-dlp (ver SIBLING_EXTENSIONS) exista ni esté reservado por otra pista. Nunca se sobrescribe
 * ni se consume un archivo de la persona. La reserva es por nombre base (cualquier formato), porque el audio
 * intermedio de un MP3 puede llamarse igual que el resultado de un M4A simultáneo.
 */
export function reserveFileBase(
  dir: string,
  base: string,
  ext: string,
  exists: (p: string) => boolean = fs.existsSync,
  taken: Set<string> = reserved,
): Reservation {
  for (let i = 0; ; i++) {
    const fileBase = i === 0 ? base : `${base} (${i})`;
    const key = keyOf(path.join(dir, fileBase));
    if (taken.has(key)) continue;
    if (exists(path.join(dir, `${fileBase}.${ext}`))) continue;
    if (SIBLING_EXTENSIONS.some((e) => exists(path.join(dir, `${fileBase}.${e}`)))) continue;
    taken.add(key);
    let released = false;
    return {
      fileBase,
      release() {
        if (released) return;
        released = true;
        taken.delete(key);
      },
    };
  }
}
