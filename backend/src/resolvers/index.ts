import fs from 'node:fs';
import path from 'node:path';
import { config, UserError, type HealthState, type Resolver } from '../core';
import { run } from './proc';
import { youtube } from './youtube';

/** Para añadir una fuente nueva basta con implementar `Resolver` y registrarla aquí. */
export const resolvers: Resolver[] = [youtube];

export function findResolver(url: string, list: Resolver[] = resolvers): Resolver {
  const resolver = list.find((r) => r.canHandle(url));
  if (!resolver) throw new UserError('Enlace no soportado. Usa un enlace de YouTube o YouTube Music (video o playlist).');
  return resolver;
}

export function getResolver(name: string): Resolver {
  const resolver = resolvers.find((r) => r.name === name);
  if (!resolver) throw new Error(`Resolver desconocido: ${name}`);
  return resolver;
}

function ffmpegBinary(): string {
  const p = config.ffmpegPath;
  if (!p) return 'ffmpeg';
  try {
    if (fs.statSync(p).isDirectory()) return path.join(p, 'ffmpeg');
  } catch {
    // se usa tal cual
  }
  return p;
}

export async function checkTools(): Promise<HealthState> {
  const [yt, ff] = await Promise.all([
    run(config.ytDlpPath, ['--version'], { timeoutMs: 10_000 }).catch(() => null),
    run(ffmpegBinary(), ['-version'], { timeoutMs: 10_000 }).catch(() => null),
  ]);
  const ytDlp = yt && yt.code === 0 ? yt.stdout.trim() : null;
  const ffmpeg = !!ff && ff.code === 0;
  return { ok: !!ytDlp && ffmpeg, ytDlp, ffmpeg };
}
