import { config, UserError } from '../core';

export type SpotifyKind = 'track' | 'playlist' | 'album';

export interface SpotifyTrackMeta {
  id: string;
  title: string;
  /** Artistas unidos con ', '. */
  artist: string;
  artists: string[];
  album: string;
  durationSec: number;
  coverUrl: string | null;
  isrc: string | null;
}

export interface SpotifyCollection {
  kind: 'playlist' | 'album';
  title: string;
  coverUrl: string | null;
  tracks: SpotifyTrackMeta[];
}

export interface SpotifyApi {
  getTrack(id: string): Promise<SpotifyTrackMeta>;
  getCollection(kind: 'playlist' | 'album', id: string): Promise<SpotifyCollection>;
}

const ID_RE = /^[0-9A-Za-z]{22}$/;
const URL_RE = /^\/(?:intl-[a-z]{2,3}(?:-[a-z]{2,4})?\/)?(track|playlist|album)\/([0-9A-Za-z]{22})\/?$/;
const URI_RE = /^spotify:(track|playlist|album):([0-9A-Za-z]{22})$/;

export function classifySpotifyUrl(raw: string): { kind: SpotifyKind; id: string } | null {
  const s = raw.trim();
  const uri = URI_RE.exec(s);
  if (uri) return { kind: uri[1] as SpotifyKind, id: uri[2]! };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'open.spotify.com') return null;
  const m = URL_RE.exec(url.pathname);
  return m ? { kind: m[1] as SpotifyKind, id: m[2]! } : null;
}

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

interface SpImage {
  url?: string;
}
interface SpArtist {
  name?: string;
}
interface SpTrack {
  id?: string | null;
  name?: string;
  type?: string;
  is_local?: boolean;
  duration_ms?: number;
  artists?: SpArtist[];
  album?: { name?: string; images?: SpImage[] };
  external_ids?: { isrc?: string };
}
interface SpPage<T> {
  items?: (T | null)[];
  next?: string | null;
}
interface SpPlaylistEntry {
  item?: SpTrack | null;
  track?: SpTrack | null;
}

const largestImage = (images: SpImage[] | undefined) => images?.[0]?.url ?? null;

function toMeta(t: SpTrack, album?: { name: string; coverUrl: string | null }): SpotifyTrackMeta | null {
  if (!t.id || !t.name || t.is_local) return null;
  if (t.type && t.type !== 'track') return null;
  const artists = (t.artists ?? []).map((a) => a.name?.trim()).filter((n): n is string => !!n);
  return {
    id: t.id,
    title: t.name.trim(),
    artist: artists.join(', ') || 'Desconocido',
    artists,
    album: album?.name ?? t.album?.name ?? '',
    durationSec: Math.round((t.duration_ms ?? 0) / 1000),
    coverUrl: album ? album.coverUrl : largestImage(t.album?.images),
    isrc: t.external_ids?.isrc ?? null,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createSpotifyApi(
  opts: { fetch?: typeof fetch; clientId?: string; clientSecret?: string; maxTracks?: number } = {},
): SpotifyApi {
  const doFetch = opts.fetch ?? fetch;
  const maxTracks = opts.maxTracks ?? config.maxResolveEntries;

  let cached: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;

  async function requestToken(): Promise<string> {
    // Las credenciales se leen en cada llamada para respetar cambios de entorno.
    const id = opts.clientId ?? process.env.SPOTIFY_CLIENT_ID;
    const secret = opts.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) throw new UserError('Spotify no está configurado en el servidor.', 503);

    let res: Response;
    try {
      res = await doFetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
    } catch {
      throw new UserError('No se pudo conectar con Spotify.', 502);
    }
    if (!res.ok) {
      if (res.status === 429) throw new UserError('Spotify está limitando las peticiones, intenta en un momento.', 429);
      throw new UserError('Spotify rechazó las credenciales del servidor.', 502);
    }
    let body: { access_token?: string; expires_in?: number };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new UserError('Respuesta no válida de Spotify.', 502);
    }
    if (!body.access_token) throw new UserError('Respuesta no válida de Spotify.', 502);
    const ttlMs = Math.max(0, (body.expires_in ?? 3600) - 60) * 1000;
    cached = { token: body.access_token, expiresAt: Date.now() + ttlMs };
    return body.access_token;
  }

  function getToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.token);
    // Peticiones concurrentes comparten una sola solicitud de token.
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  function mapError(status: number): UserError {
    if (status === 404) return new UserError('No se encontró en Spotify (¿es privado o fue eliminado?).', 422);
    if (status === 403)
      return new UserError(
        'Spotify no permite leer este contenido con la aplicación del servidor (por ejemplo playlists privadas o editoriales de Spotify, o la app tiene restricciones de modo desarrollo).',
        422,
      );
    if (status === 429) return new UserError('Spotify está limitando las peticiones, intenta en un momento.', 429);
    return new UserError('Spotify devolvió un error inesperado. Intenta de nuevo más tarde.', 502);
  }

  /** GET autenticado. Los estados de `tolerate` se devuelven como null en vez de lanzar error. */
  async function get<T>(urlOrPath: string, tolerate: number[] = []): Promise<T | null> {
    const url = urlOrPath.startsWith('http') ? urlOrPath : `${API}${urlOrPath}`;
    // No se envía el token a hosts ajenos (p. ej. un `next` manipulado).
    if (!url.startsWith(`${API}/`)) throw new UserError('Respuesta no válida de Spotify.', 502);

    let refreshed = false;
    let waited = false;
    for (;;) {
      const token = await getToken();
      let res: Response;
      try {
        res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        throw new UserError('No se pudo conectar con Spotify.', 502);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        cached = null;
        continue;
      }
      if (res.status === 429 && !waited) {
        const header = res.headers.get('retry-after');
        const secs = header === null ? NaN : Number(header);
        if (Number.isFinite(secs) && secs >= 0 && secs <= 5) {
          waited = true;
          await sleep(secs * 1000);
          continue;
        }
      }
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new UserError('Respuesta no válida de Spotify.', 502);
        }
      }
      if (tolerate.includes(res.status)) return null;
      throw mapError(res.status);
    }
  }

  const need = async <T>(path: string) => (await get<T>(path)) as T;

  function checkId(id: string) {
    if (!ID_RE.test(id)) throw new UserError('Identificador de Spotify no válido.', 400);
  }

  async function getTrack(id: string): Promise<SpotifyTrackMeta> {
    checkId(id);
    const t = await need<SpTrack>(`/tracks/${id}`);
    const meta = toMeta(t);
    if (!meta) throw new UserError('Esta canción no está disponible en Spotify.', 422);
    return meta;
  }

  async function getAlbum(id: string): Promise<SpotifyCollection> {
    const a = await need<{
      name?: string;
      images?: SpImage[];
      tracks?: SpPage<SpTrack>;
    }>(`/albums/${id}`);
    const album = { name: a.name?.trim() ?? '', coverUrl: largestImage(a.images) };
    const tracks: SpotifyTrackMeta[] = [];
    let page: SpPage<SpTrack> | null = a.tracks ?? null;
    while (page && tracks.length < maxTracks) {
      for (const t of page.items ?? []) {
        const m = t && toMeta(t, album);
        if (m && tracks.length < maxTracks) tracks.push(m);
      }
      page = page.next && tracks.length < maxTracks ? await get<SpPage<SpTrack>>(page.next) : null;
    }
    return { kind: 'album', title: album.name || 'Álbum', coverUrl: album.coverUrl, tracks };
  }

  async function getPlaylist(id: string): Promise<SpotifyCollection> {
    const p = await need<{ name?: string; images?: SpImage[] }>(`/playlists/${id}?fields=name,images`);

    // Apps nuevas usan /items; las antiguas /tracks. Se prueba la nueva primero.
    let first = await get<SpPage<SpPlaylistEntry>>(`/playlists/${id}/items?limit=100`, [404, 410]);
    first ??= await need<SpPage<SpPlaylistEntry>>(`/playlists/${id}/tracks?limit=100`);

    const tracks: SpotifyTrackMeta[] = [];
    let page: SpPage<SpPlaylistEntry> | null = first;
    while (page && tracks.length < maxTracks) {
      for (const entry of page.items ?? []) {
        const t = entry?.item ?? entry?.track;
        const m = t && toMeta(t);
        if (m && tracks.length < maxTracks) tracks.push(m);
      }
      page = page.next && tracks.length < maxTracks ? await get<SpPage<SpPlaylistEntry>>(page.next) : null;
    }
    return { kind: 'playlist', title: p.name?.trim() || 'Playlist', coverUrl: largestImage(p.images), tracks };
  }

  return {
    getTrack,
    async getCollection(kind, id) {
      checkId(id);
      return kind === 'album' ? getAlbum(id) : getPlaylist(id);
    },
  };
}
