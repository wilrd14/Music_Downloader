import { UserError, type ResolvedSource, type Resolver, type TrackInfo } from '../core';
import { findYoutubeMatch } from './match';
import { classifySpotifyUrl, createSpotifyApi, type SpotifyApi, type SpotifyTrackMeta } from './spotify-api';
import { tagAudio } from './tagger';
import { youtube } from './youtube';

const trackUrl = (id: string) => `https://open.spotify.com/track/${id}`;

function toTrack(m: SpotifyTrackMeta): TrackInfo {
  return {
    id: m.id,
    title: m.title,
    artist: m.artist,
    durationSec: m.durationSec,
    thumbnail: m.coverUrl,
    album: m.album,
    url: trackUrl(m.id),
  };
}

export interface SpotifyResolverDeps {
  api?: SpotifyApi;
  audio?: Resolver;
  findMatch?: typeof findYoutubeMatch;
  tag?: typeof tagAudio;
}

/** Spotify solo aporta metadatos: el audio se busca en YouTube y se etiqueta con los datos de Spotify. */
export function createSpotifyResolver(deps: SpotifyResolverDeps = {}): Resolver {
  const api = deps.api ?? createSpotifyApi();
  const audio = deps.audio ?? youtube;
  const findMatch = deps.findMatch ?? findYoutubeMatch;
  const tag = deps.tag ?? tagAudio;

  return {
    name: 'spotify',

    canHandle: (url) => classifySpotifyUrl(url) !== null,

    async resolve(url): Promise<ResolvedSource> {
      const ref = classifySpotifyUrl(url);
      if (!ref) throw new UserError('Enlace de Spotify no válido. Usa una canción, álbum o playlist.');

      if (ref.kind === 'track') {
        const meta = await api.getTrack(ref.id);
        return {
          provider: 'spotify',
          kind: 'track',
          title: meta.title,
          thumbnail: meta.coverUrl,
          sourceUrl: url,
          tracks: [toTrack(meta)],
        };
      }

      // Spotify ya no deja leer las canciones de una playlist con las credenciales de la app (exige
      // que el usuario inicie sesión); los álbumes y las canciones sueltas sí.
      if (ref.kind === 'playlist') {
        throw new UserError(
          'Spotify no permite leer playlists desde esta herramienta. Pega el enlace de una canción o álbum de Spotify, o una playlist de YouTube.',
          422,
        );
      }

      const col = await api.getCollection(ref.kind, ref.id);
      if (!col.tracks.length) throw new UserError('La lista está vacía o no se puede leer.', 422);
      return {
        provider: 'spotify',
        kind: 'playlist',
        title: col.title,
        thumbnail: col.coverUrl ?? col.tracks[0]?.coverUrl ?? null,
        sourceUrl: url,
        tracks: col.tracks.map(toTrack),
      };
    },

    async download(track, opts) {
      opts.onProgress(0, 'downloading');
      const match = await findMatch({ title: track.title, artist: track.artist, durationSec: track.durationSec ?? 0 });
      if (!match) throw new UserError('No se encontró una coincidencia fiable en YouTube.');

      // Se descarga sin los datos de YouTube; el último 4 % queda para el etiquetado.
      const file = await audio.download(
        { ...track, url: match.url },
        { ...opts, embed: false, onProgress: (p, phase) => opts.onProgress(Math.min(p, 96), phase) },
      );
      await tag(file, opts.format, {
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        coverUrl: track.thumbnail,
      });
      opts.onProgress(100, 'converting');
      return file;
    },
  };
}

export const spotify: Resolver = createSpotifyResolver();
