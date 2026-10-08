import fs from 'node:fs';
import path from 'node:path';

/** Suma el tamaño de todos los archivos de una carpeta (recursivo). Carpeta inexistente = 0. */
export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += await dirSize(p);
      else if (e.isFile()) total += (await fs.promises.stat(p)).size;
    } catch {
      // el archivo desapareció entre readdir y stat (lo borra el worker)
    }
  }
  return total;
}

export interface DiskUsageOptions {
  ttlMs?: number;
  now?: () => number;
  measure?: (dir: string) => Promise<number>;
}

/** Medidor de uso de disco con caché (por defecto ~10 s) para no recorrer la carpeta en cada petición. */
export function createDiskUsage(dir: string, opts: DiskUsageOptions = {}): () => Promise<number> {
  const ttl = opts.ttlMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const measure = opts.measure ?? dirSize;
  let cached: { at: number; bytes: number } | null = null;
  let inflight: Promise<number> | null = null;
  return async () => {
    if (cached && now() - cached.at < ttl) return cached.bytes;
    inflight ??= measure(dir)
      .then((bytes) => {
        cached = { at: now(), bytes };
        return bytes;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
