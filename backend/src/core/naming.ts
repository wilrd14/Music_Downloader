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
 * Elige `base`, o `base (1)`, `base (2)`... antes de la extensión, de modo que `<dir>/<nombre>.<ext>` no exista
 * ni esté reservado por otra pista. Nunca se sobrescribe un archivo de la persona.
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
    const full = path.join(dir, `${fileBase}.${ext}`);
    const key = keyOf(full);
    if (taken.has(key) || exists(full)) continue;
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
