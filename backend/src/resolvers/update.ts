import { config, isInside, readSettings, updateSettings } from '../core';
import { run, type RunOptions, type RunResult } from './proc';

const DAY_MS = 24 * 60 * 60_000;

export interface AutoUpdateOptions {
  /** Por defecto `config.ytDlpAutoUpdate` (modo local y YT_DLP_AUTO_UPDATE distinto de 0). */
  enabled?: boolean;
  ytDlpPath?: string;
  binDir?: string;
  dataDir?: string;
  now?: () => number;
  run?: (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;
  log?: (...args: unknown[]) => void;
}

export type AutoUpdateOutcome = 'disabled' | 'not-bundled' | 'recent' | 'updated' | 'failed';

/**
 * Actualiza yt-dlp (`yt-dlp -U`) como máximo una vez cada 24 h, y SOLO si el binario vive dentro de la carpeta
 * `bin` empaquetada con la app: nunca se toca una instalación del sistema (winget, apt, pip...).
 * Cualquier fallo se registra y se ignora: nunca impide arrancar. La hora de la última comprobación se guarda
 * en settings.json aunque falle, para no insistir en cada arranque.
 */
export async function maybeUpdateYtDlp(opts: AutoUpdateOptions = {}): Promise<AutoUpdateOutcome> {
  const {
    enabled = config.ytDlpAutoUpdate,
    ytDlpPath = config.ytDlpPath,
    binDir = config.binDir,
    dataDir = config.dataDir,
    now = Date.now,
    run: exec = run,
    log = (...a: unknown[]) => console.log(new Date().toISOString(), '[yt-dlp]', ...a),
  } = opts;

  if (!enabled) return 'disabled';
  // Una ruta sin carpeta ("yt-dlp", del PATH) nunca está dentro de bin/.
  if (!/[\\/]/.test(ytDlpPath) || !isInside(binDir, ytDlpPath)) return 'not-bundled';
  const last = readSettings(dataDir).ytDlpLastCheck;
  if (last !== undefined && now() - last < DAY_MS) return 'recent';

  try {
    const res = await exec(ytDlpPath, ['-U'], { timeoutMs: 120_000 });
    updateSettings(dataDir, { ytDlpLastCheck: now() });
    if (res.code !== 0) {
      log(`la actualización terminó con código ${res.code}: ${res.stderr.trim().slice(-200)}`);
      return 'failed';
    }
    log(res.stdout.trim().split(/\r?\n/).pop() || 'actualización comprobada');
    return 'updated';
  } catch (err) {
    try {
      updateSettings(dataDir, { ytDlpLastCheck: now() });
    } catch {
      // sin permisos de escritura: se reintentará en el próximo arranque
    }
    log('no se pudo actualizar yt-dlp:', err instanceof Error ? err.message : err);
    return 'failed';
  }
}
