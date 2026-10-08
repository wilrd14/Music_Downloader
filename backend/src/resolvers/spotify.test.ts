import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError, type DownloadOptions, type Resolver, type TrackInfo } from '../core';
import { createSpotifyResolver } from './spotify';
import type { SpotifyApi, SpotifyTrackMeta } from './spotify-api';

const meta: SpotifyTrackMeta = {
  id: '1SUGOWZuixBXBUEDYN6hMu',
  title: 'Berlín',
  artist: 'K4OS',
  artists: ['K4OS'],
  album: 'Berlín',
  durationSec: 200,
  coverUrl: 'https://i.scdn.co/image/abc',
  isrc: null,
};

const fakeApi = (over: Partial<SpotifyApi> = {}): SpotifyApi => ({
  getTrack: async () => meta,
  getCollection: async (kind) => ({ kind, title: 'Disco', coverUrl: null, tracks: [meta, { ...meta, id: 'x'.repeat(22) }] }),
  ...over,
});

const TRACK_URL = 'https://open.spotify.com/track/1SUGOWZuixBXBUEDYN6hMu?si=abc';
const ALBUM_URL = 'https://open.spotify.com/album/1SUGOWZuixBXBUEDYN6hMu';
const PLAYLIST_URL = 'https://open.spotify.com/playlist/1aBh4jVW0EwjLuCm0peW6h';

test('canHandle solo acepta enlaces de Spotify', () => {
  const r = createSpotifyResolver({ api: fakeApi() });
  assert.equal(r.canHandle(TRACK_URL), true);
  assert.equal(r.canHandle('https://www.youtube.com/watch?v=jNQXAC9IVRw'), false);
});

test('resolve: canción individual conserva álbum y portada', async () => {
  const src = await createSpotifyResolver({ api: fakeApi() }).resolve(TRACK_URL);
  assert.equal(src.kind, 'track');
  assert.equal(src.tracks[0]?.album, 'Berlín');
  assert.equal(src.tracks[0]?.thumbnail, meta.coverUrl);
});

test('resolve: álbum se trata como lista de pistas', async () => {
  const src = await createSpotifyResolver({ api: fakeApi() }).resolve(ALBUM_URL);
  assert.equal(src.kind, 'playlist');
  assert.equal(src.tracks.length, 2);
});

test('resolve: playlists dan un error claro sin llamar a la API', async () => {
  let called = false;
  const api = fakeApi({
    getCollection: async () => {
      called = true;
      throw new Error('no debería llamarse');
    },
  });
  await assert.rejects(
    createSpotifyResolver({ api }).resolve(PLAYLIST_URL),
    (e: unknown) => e instanceof UserError && e.status === 422 && /playlist/i.test(e.message),
  );
  assert.equal(called, false);
});

test('download: busca en YouTube, descarga sin embed y etiqueta con datos de Spotify', async () => {
  let ytTrack: TrackInfo | undefined;
  let ytOpts: DownloadOptions | undefined;
  const audio: Resolver = {
    name: 'youtube',
    canHandle: () => true,
    resolve: async () => {
      throw new Error('no se usa');
    },
    download: async (t, o) => {
      ytTrack = t;
      ytOpts = o;
      o.onProgress(100, 'converting');
      return 'C:\tmp\K4OS - Berlín.mp3';
    },
  };
  let tagged: unknown[] = [];
  const progress: number[] = [];
  const r = createSpotifyResolver({
    api: fakeApi(),
    audio,
    findMatch: async () => ({ url: 'https://www.youtube.com/watch?v=abc', title: 'Berlín', durationSec: 200, score: 90 }),
    tag: async (...args) => {
      tagged = args;
    },
  });
  const track: TrackInfo = {
    id: meta.id,
    title: 'Berlín',
    artist: 'K4OS',
    durationSec: 200,
    thumbnail: meta.coverUrl,
    album: 'Berlín',
    url: 'https://open.spotify.com/track/' + meta.id,
  };
  const file = await r.download(track, {
    outDir: 'C:\tmp',
    fileBase: 'K4OS - Berlín',
    format: 'mp3',
    onProgress: (p) => progress.push(p),
  });
  assert.equal(file, 'C:\tmp\K4OS - Berlín.mp3');
  assert.equal(ytTrack?.url, 'https://www.youtube.com/watch?v=abc');
  assert.equal(ytOpts?.embed, false);
  assert.deepEqual(tagged, [file, 'mp3', { title: 'Berlín', artist: 'K4OS', album: 'Berlín', coverUrl: meta.coverUrl }]);
  assert.ok(Math.max(...progress.slice(0, -1)) <= 96, 'la descarga no pasa del 96 %');
  assert.equal(progress.at(-1), 100);
});

test('download: sin coincidencia en YouTube falla con mensaje claro', async () => {
  const r = createSpotifyResolver({ api: fakeApi(), findMatch: async () => null });
  await assert.rejects(
    r.download(
      { id: 'a', title: 'x', artist: 'y', durationSec: 10, thumbnail: null, url: 'u' },
      { outDir: 'd', fileBase: 'f', format: 'mp3', onProgress() {} },
    ),
    (e: unknown) => e instanceof UserError && /coincidencia/i.test(e.message),
  );
});
