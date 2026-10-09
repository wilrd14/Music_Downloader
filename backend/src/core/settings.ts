import fs from 'node:fs';
import path from 'node:path';

/** Ajustes persistentes del modo local: `<dataDir>/settings.json`. */
export interface Settings {
  /** Carpeta de música elegida por la persona (ruta absoluta ya validada). */
  downloadDir?: string;
  /** Marca de tiempo (ms) de la última comprobación de actualización de yt-dlp. */
  ytDlpLastCheck?: number;
}

export const settingsPath = (dataDir: string) => path.join(dataDir, 'settings.json');

/** Lee los ajustes; archivo ausente, ilegible o corrupto = `{}`. Solo se conservan campos con el tipo esperado. */
export function readSettings(dataDir: string): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(dataDir), 'utf8')) as Record<string, unknown>;
    const out: Settings = {};
    if (typeof raw.downloadDir === 'string' && raw.downloadDir) out.downloadDir = raw.downloadDir;
    if (typeof raw.ytDlpLastCheck === 'number' && Number.isFinite(raw.ytDlpLastCheck)) out.ytDlpLastCheck = raw.ytDlpLastCheck;
    return out;
  } catch {
    return {};
  }
}

/** Fusiona `patch` con lo guardado y escribe de forma atómica (archivo temporal + rename). Devuelve el resultado. */
export function updateSettings(dataDir: string, patch: Partial<Settings>): Settings {
  const next = { ...readSettings(dataDir), ...patch };
  fs.mkdirSync(dataDir, { recursive: true });
  const file = settingsPath(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  return next;
}
