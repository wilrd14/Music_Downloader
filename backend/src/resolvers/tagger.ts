import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, UserError } from '../core';
import { run } from './proc';
import type { CommandRunner } from './youtube';

export interface TagMeta {
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
}

/** Solo se descargan portadas de estos hosts. */
const COVER_HOSTS = new Set(['i.scdn.co', 'i.ytimg.com']);
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_TIMEOUT_MS = 15_000;
const FFMPEG_TIMEOUT_MS = 60_000;

/** Misma lógica que ffmpegBinary() de index.ts: config.ffmpegPath puede ser carpeta o binario. */
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

/** Quita caracteres de control (los valores van como argumentos, sin shell). */
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/** Descarga la portada (solo https, tamaño y tiempo limitados). Devuelve null si falla. */
async function downloadCover(url: string, fetchFn: typeof fetch): Promise<Buffer | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !COVER_HOSTS.has(u.hostname)) return null;
    // Sin seguir redirecciones: evita que un host permitido nos mande a otro destino (SSRF).
    const res = await fetchFn(u, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS), redirect: 'error' });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_COVER_BYTES) return null;

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_COVER_BYTES) return null;
      chunks.push(Buffer.from(chunk));
    }
    return total > 0 ? Buffer.concat(chunks) : null;
  } catch {
    return null;
  }
}

function buildArgs(input: string, cover: string | null, format: 'mp3' | 'm4a', meta: TagMeta, output: string) {
  const title = clean(meta.title);
  const artist = clean(meta.artist);
  const album = meta.album ? clean(meta.album) : '';
  return [
    '-y',
    '-v',
    'error',
    '-i',
    input,
    ...(cover ? ['-i', cover] : []),
    '-map',
    '0:a',
    ...(cover ? ['-map', '1:v'] : []),
    '-c',
    'copy',
    // Descarta cualquier etiqueta o capítulo de la fuente.
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-metadata',
    `title=${title}`,
    '-metadata',
    `artist=${artist}`,
    '-metadata',
    `album_artist=${artist}`,
    ...(album ? ['-metadata', `album=${album}`] : []),
    ...(format === 'mp3' ? ['-id3v2_version', '3'] : []),
    ...(cover && format === 'mp3'
      ? ['-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
      : []),
    ...(cover && format === 'm4a' ? ['-disposition:v:0', 'attached_pic'] : []),
    output,
  ];
}

/**
 * Reescribe `file` con las etiquetas de Spotify (y la portada, si se puede) usando ffmpeg.
 * Si falla algo, el archivo original queda intacto.
 */
export async function tagAudio(
  file: string,
  format: 'mp3' | 'm4a',
  meta: TagMeta,
  opts: { fetch?: typeof fetch; runCmd?: CommandRunner } = {},
): Promise<void> {
  const runCmd = opts.runCmd ?? run;
  const fetchFn = opts.fetch ?? fetch;
  const id = crypto.randomBytes(6).toString('hex');
  const output = path.join(path.dirname(file), `.${path.basename(file, path.extname(file))}.tag-${id}.${format}`);
  let coverDir: string | null = null;

  /** Ejecuta ffmpeg y, si sale bien, reemplaza el original de forma atómica. */
  const attempt = async (cover: string | null): Promise<boolean> => {
    try {
      const res = await runCmd(ffmpegBinary(), buildArgs(file, cover, format, meta, output), {
        timeoutMs: FFMPEG_TIMEOUT_MS,
      });
      if (res.code !== 0 || !fs.existsSync(output) || fs.statSync(output).size === 0) return false;
      fs.renameSync(output, file);
      return true;
    } catch (err) {
      if (err instanceof UserError && err.status !== 504) throw err; // p. ej. ffmpeg no instalado
      return false;
    } finally {
      fs.rmSync(output, { force: true });
    }
  };

  try {
    let coverFile: string | null = null;
    if (meta.coverUrl) {
      const bytes = await downloadCover(meta.coverUrl, fetchFn);
      if (bytes) {
        coverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-cover-'));
        coverFile = path.join(coverDir, 'cover.jpg');
        fs.writeFileSync(coverFile, bytes);
      }
    }

    // La portada es opcional: si falla incrustarla, se reintenta solo con el texto.
    if (coverFile && (await attempt(coverFile))) return;
    if (await attempt(null)) return;
    throw new UserError('No se pudieron escribir las etiquetas del archivo.', 500);
  } finally {
    fs.rmSync(output, { force: true });
    if (coverDir) fs.rmSync(coverDir, { recursive: true, force: true });
  }
}
