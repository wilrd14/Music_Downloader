import fs from 'node:fs';
import path from 'node:path';
import {
  config,
  UserError,
  type BinarySource,
  type DownloadOptions,
  type ResolvedSource,
  type Resolver,
  type TrackInfo,
} from '../core';
import { run, type RunOptions, type RunResult } from './proc';

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

interface YtEntry {
  id?: string;
  title?: string;
  uploader?: string | null;
  channel?: string | null;
  artist?: string | null;
  track?: string | null;
  duration?: number | null;
  availability?: string | null;
}

interface YtInfo extends YtEntry {
  _type?: string;
  entries?: (YtEntry | null)[];
}

const UNAVAILABLE_TITLES = /^\[(private|deleted) video\]$/i;

export function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Decide si el enlace es un video o una playlist. Devuelve null si no es soportado. */
export function classify(url: URL): 'track' | 'playlist' | null {
  if (!YT_HOSTS.has(url.hostname)) return null;
  // Solo el puerto estándar y sin credenciales: ni `youtube.com:8080` ni `usuario:clave@youtube.com` llegan a yt-dlp.
  if (url.port || url.username || url.password) return null;
  if (url.hostname === 'youtu.be') return url.pathname.length > 1 ? 'track' : null;
  if (url.pathname === '/playlist') return url.searchParams.get('list') ? 'playlist' : null;
  if (url.pathname === '/watch') return url.searchParams.get('v') ? 'track' : null;
  if (/^\/(shorts|live)\/[\w-]+/.test(url.pathname)) return 'track';
  return null;
}

const cleanArtist = (name: string | null | undefined) =>
  (name ?? '').replace(/\s*-\s*Topic$/i, '').trim() || 'Desconocido';

const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** Un id de YouTube son letras, cifras, `_` y `-`; se exige porque se inserta en una URL y en la ruta de la miniatura. */
const YT_ID_RE = /^[\w-]{1,64}$/;

function toTrack(e: YtEntry): TrackInfo | null {
  if (!e.id || !YT_ID_RE.test(e.id) || !e.title || UNAVAILABLE_TITLES.test(e.title)) return null;
  return {
    id: e.id,
    title: (e.track ?? e.title).trim(),
    artist: cleanArtist(e.artist ?? e.channel ?? e.uploader),
    durationSec: typeof e.duration === 'number' ? Math.round(e.duration) : null,
    thumbnail: thumbUrl(e.id),
    url: videoUrl(e.id),
  };
}

function friendlyError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('private video') || s.includes('this playlist is private')) return 'El contenido es privado.';
  if (s.includes('video unavailable') || s.includes('has been removed') || s.includes('does not exist'))
    return 'El video o la playlist no está disponible.';
  if (s.includes('sign in to confirm') || s.includes('not a bot'))
    return 'YouTube bloqueó la petición (verificación anti-bot). Intenta de nuevo más tarde.';
  if (s.includes('age') && s.includes('restricted')) return 'El video tiene restricción de edad.';
  if (s.includes('copyright') || s.includes('blocked it in your country'))
    return 'El video está bloqueado por derechos de autor o por región.';
  if (s.includes('http error 429') || s.includes('too many requests'))
    return 'Demasiadas peticiones a YouTube. Espera unos minutos.';
  if (s.includes('unable to download') || s.includes('urlopen error') || s.includes('getaddrinfo'))
    return 'No se pudo conectar con YouTube.';
  return 'No se pudo descargar esta pista.';
}

function ffmpegArgs(): string[] {
  return config.ffmpegPath ? ['--ffmpeg-location', config.ffmpegPath] : [];
}

export type CommandRunner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/**
 * Con el yt-dlp empaquetado se ignoran los archivos de configuración de yt-dlp: busca `yt-dlp.conf` en la carpeta
 * actual, junto al ejecutable y en el perfil, y una línea `--exec ...` ahí ejecutaría un programa con cada descarga.
 */
export function configArgs(source: BinarySource): string[] {
  return source === 'bundled' ? ['--ignore-config'] : [];
}

/** `runCmd` es inyectable para poder probar el parseo sin yt-dlp instalado. */
export function createYoutubeResolver(runCmd: CommandRunner = run, source: BinarySource = config.ytDlpSource): Resolver {
  return {
    name: 'youtube',

    canHandle(raw) {
      const url = parseUrl(raw);
      return !!url && classify(url) !== null;
    },

    async resolve(raw): Promise<ResolvedSource> {
      const url = parseUrl(raw);
      const kind = url && classify(url);
      if (!url || !kind) throw new UserError('Enlace de YouTube no válido. Usa un video o una playlist.');

      const args = [
        ...configArgs(source),
        '-J',
        '--flat-playlist',
        '--no-warnings',
        '--playlist-end',
        String(config.maxResolveEntries),
        kind === 'playlist' ? '--yes-playlist' : '--no-playlist',
        '--', // fin de opciones: la URL nunca se interpreta como opción
        url.toString(),
      ];
      const res = await runCmd(config.ytDlpPath, args, { timeoutMs: 60_000 });
      if (res.code !== 0) throw new UserError(friendlyError(res.stderr), 422);

      let info: YtInfo;
      try {
        info = JSON.parse(res.stdout) as YtInfo;
      } catch {
        throw new UserError('No se pudo leer la información del enlace.', 502);
      }

      if (kind === 'track') {
        const track = toTrack(info);
        if (!track) throw new UserError('El video no está disponible.', 422);
        return {
          provider: 'youtube',
          kind,
          title: track.title,
          thumbnail: track.thumbnail,
          sourceUrl: url.toString(),
          tracks: [track],
        };
      }

      const tracks = (info.entries ?? []).flatMap((e) => (e ? (toTrack(e) ?? []) : []));
      if (!tracks.length) throw new UserError('La playlist está vacía o no es pública.', 422);
      return {
        provider: 'youtube',
        kind,
        title: info.title?.trim() || 'Playlist',
        thumbnail: tracks[0]?.thumbnail ?? null,
        sourceUrl: url.toString(),
        tracks,
      };
    },

    async download(track, opts: DownloadOptions) {
      fs.mkdirSync(opts.outDir, { recursive: true });
      const base = path.join(opts.outDir, opts.fileBase);
      const finalPath = `${base}.${opts.format}`;

      const args = [
        ...configArgs(source),
        '-x',
        '--audio-format',
        opts.format,
        ...(opts.format === 'mp3' ? ['--audio-quality', '320K'] : []),
        '--embed-metadata',
        '--embed-thumbnail',
        '--convert-thumbnails',
        'jpg',
        '--no-playlist',
        '--newline',
        '--no-colors',
        '--no-warnings',
        '--retries',
        '3',
        '--socket-timeout',
        '20',
        ...ffmpegArgs(),
        '-o',
        // Los % del nombre se escapan para que yt-dlp no los interprete como plantilla.
        `${base.replace(/%/g, '%%')}.%(ext)s`,
        '--',
        track.url,
      ];

      let phase: 'downloading' | 'converting' = 'downloading';
      const res = await runCmd(config.ytDlpPath, args, {
        signal: opts.signal,
        timeoutMs: config.trackTimeoutMs,
        onLine(line) {
          const dl = /\[download\]\s+([\d.]+)%/.exec(line);
          if (dl && phase === 'downloading') {
            // La descarga ocupa el 0-90 %, la conversión el resto.
            opts.onProgress(Math.min(90, Number(dl[1]) * 0.9), 'downloading');
          } else if (/^\[(ExtractAudio|Metadata|ThumbnailsConvertor|EmbedThumbnail|FixupM4a)\]/.test(line)) {
            if (phase !== 'converting') {
              phase = 'converting';
              opts.onProgress(92, 'converting');
            }
          }
        },
      });

      if (res.code !== 0) {
        // El mensaje al usuario es genérico; el detalle real queda en el log del servidor.
        const detail = res.stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
        console.error(`[yt-dlp] ${track.id} salió con código ${res.code}: ${detail}`);
        throw new UserError(friendlyError(res.stderr));
      }
      if (!fs.existsSync(finalPath)) throw new UserError('La conversión no produjo ningún archivo (¿falta ffmpeg?).');
      opts.onProgress(100, 'converting');
      return finalPath;
    },
  };
}

export const youtube: Resolver = createYoutubeResolver();
