import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserError } from '../core';
import { classifySpotifyUrl, createSpotifyApi } from './spotify-api';

const ID = '1SUGOWZuixBXBUEDYN6hMu';
const ID2 = '37i9dQZF1DXcBWIGoYBM5M';

test('classifySpotifyUrl: enlaces válidos', () => {
  const c = classifySpotifyUrl;
  assert.deepEqual(c(`https://open.spotify.com/track/${ID}`), { kind: 'track', id: ID });
  assert.deepEqual(c(`https://open.spotify.com/track/${ID}?si=abc123`), { kind: 'track', id: ID });
  assert.deepEqual(c(`https://open.spotify.com/intl-es/track/${ID}?si=x`), { kind: 'track', id: ID });
  assert.deepEqual(c(`https://open.spotify.com/intl-pt-br/album/${ID}`), { kind: 'album', id: ID });
  assert.deepEqual(c(`https://open.spotify.com/playlist/${ID2}?si=1&pt=2`), { kind: 'playlist', id: ID2 });
  assert.deepEqual(c(`  https://open.spotify.com/album/${ID}/  `), { kind: 'album', id: ID });
  assert.deepEqual(c(`spotify:track:${ID}`), { kind: 'track', id: ID });
  assert.deepEqual(c(`spotify:playlist:${ID2}`), { kind: 'playlist', id: ID2 });
});

test('classifySpotifyUrl: enlaces inválidos', () => {
  const c = classifySpotifyUrl;
  for (const bad of [
    '',
    'hola',
    ID,
    `open.spotify.com/track/${ID}`,
    `https://evil.com/track/${ID}`,
    `https://open.spotify.com.evil.com/track/${ID}`,
    `https://spotify.com/track/${ID}`,
    `https://open.spotify.com/artist/${ID}`,
    `https://open.spotify.com/episode/${ID}`,
    `https://open.spotify.com/track/${ID.slice(1)}`,
    `https://open.spotify.com/track/${ID}x`,
    `https://open.spotify.com/track/${ID.slice(1)}!`,
    'https://open.spotify.com/track/',
    `https://open.spotify.com/user/foo/track/${ID}`,
    `ftp://open.spotify.com/track/${ID}`,
    `spotify:artist:${ID}`,
    `spotify:track:${ID.slice(1)}`,
    `javascript:alert(1)//open.spotify.com/track/${ID}`,
  ]) {
    assert.equal(c(bad), null, bad);
  }
});

// --- Helpers de fetch simulado ---

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const tokenRes = (token = 'tok', expiresIn = 3600) => json({ access_token: token, expires_in: expiresIn });

function mockFetch(handler: Handler) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls, apiCalls: () => calls.filter((c) => !c.url.includes('accounts.spotify.com')) };
}

const isToken = (url: string) => url === 'https://accounts.spotify.com/api/token';

const trackJson = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `track${String(n).padStart(17, '0')}`,
  name: `Canción ${n}`,
  type: 'track',
  duration_ms: 200_400 + n,
  artists: [{ name: 'Uno' }, { name: 'Dos' }],
  album: { name: 'Disco', images: [{ url: 'https://img/big' }, { url: 'https://img/small' }] },
  external_ids: { isrc: `ISRC${n}` },
  ...extra,
});

const mk = (fn: typeof fetch, extra: Parameters<typeof createSpotifyApi>[0] = {}) =>
  createSpotifyApi({ fetch: fn, clientId: 'cid', clientSecret: 'secret', ...extra });

const rejectsUser = (p: Promise<unknown>, status: number, re?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof UserError, String(e));
    assert.equal(e.status, status);
    if (re) assert.match(e.message, re);
    return true;
  });

// --- Token ---

test('sin credenciales: UserError 503', async () => {
  const saved = [process.env.SPOTIFY_CLIENT_ID, process.env.SPOTIFY_CLIENT_SECRET];
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
  try {
    const m = mockFetch(() => tokenRes());
    await rejectsUser(createSpotifyApi({ fetch: m.fn }).getTrack(ID), 503, /no está configurado/);
    assert.equal(m.calls.length, 0);
  } finally {
    if (saved[0] !== undefined) process.env.SPOTIFY_CLIENT_ID = saved[0];
    if (saved[1] !== undefined) process.env.SPOTIFY_CLIENT_SECRET = saved[1];
  }
});

test('token: Basic auth, cacheado y compartido entre peticiones concurrentes', async () => {
  const m = mockFetch((url) => (isToken(url) ? tokenRes() : json(trackJson(1))));
  const api = mk(m.fn);
  await Promise.all([api.getTrack(ID), api.getTrack(ID), api.getTrack(ID)]);
  await api.getTrack(ID);

  const tokenCalls = m.calls.filter((c) => isToken(c.url));
  assert.equal(tokenCalls.length, 1);
  const init = tokenCalls[0]!.init!;
  assert.equal(init.method, 'POST');
  assert.equal(init.body, 'grant_type=client_credentials');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Basic ${Buffer.from('cid:secret').toString('base64')}`);
  for (const c of m.apiCalls()) {
    assert.equal((c.init!.headers as Record<string, string>).Authorization, 'Bearer tok');
  }
});

test('token: se renueva cuando está por expirar', async () => {
  let n = 0;
  const m = mockFetch((url) => (isToken(url) ? tokenRes(`tok${++n}`, 30) : json(trackJson(1))));
  const api = mk(m.fn);
  await api.getTrack(ID);
  await api.getTrack(ID); // expires_in 30 s < margen de 60 s: ya no sirve
  assert.equal(m.calls.filter((c) => isToken(c.url)).length, 2);
});

test('401: renueva el token y reintenta una vez', async () => {
  let n = 0;
  const m = mockFetch((url, init) => {
    if (isToken(url)) return tokenRes(`tok${++n}`);
    const auth = (init!.headers as Record<string, string>).Authorization;
    return auth === 'Bearer tok1' ? json({ error: {} }, 401) : json(trackJson(1));
  });
  const t = await mk(m.fn).getTrack(ID);
  assert.equal(t.title, 'Canción 1');
  assert.equal(n, 2);
});

test('401 persistente: error tras un solo reintento', async () => {
  const m = mockFetch((url) => (isToken(url) ? tokenRes() : json({}, 401)));
  await rejectsUser(mk(m.fn).getTrack(ID), 502);
  assert.equal(m.apiCalls().length, 2);
});

test('credenciales rechazadas: error sin filtrar secretos', async () => {
  const m = mockFetch(() => json({ error: 'invalid_client' }, 400));
  await assert.rejects(mk(m.fn).getTrack(ID), (e: unknown) => {
    assert.ok(e instanceof UserError);
    assert.equal(e.status, 502);
    assert.ok(!e.message.includes('secret'));
    return true;
  });
});

// --- Tracks ---

test('getTrack: mapea los campos', async () => {
  const m = mockFetch((url) => (isToken(url) ? tokenRes() : json(trackJson(7))));
  const t = await mk(m.fn).getTrack(ID);
  assert.deepEqual(t, {
    id: 'track00000000000000007',
    title: 'Canción 7',
    artist: 'Uno, Dos',
    artists: ['Uno', 'Dos'],
    album: 'Disco',
    durationSec: 200,
    coverUrl: 'https://img/big',
    isrc: 'ISRC7',
  });
  assert.equal(m.apiCalls()[0]!.url, `https://api.spotify.com/v1/tracks/${ID}`);
});

test('getTrack: sin imágenes ni ISRC', async () => {
  const m = mockFetch((url) =>
    isToken(url) ? tokenRes() : json({ id: ID, name: 'X', duration_ms: 1500, artists: [{ name: 'A' }], album: { name: 'B' } }),
  );
  const t = await mk(m.fn).getTrack(ID);
  assert.equal(t.coverUrl, null);
  assert.equal(t.isrc, null);
  assert.equal(t.durationSec, 2);
});

test('id inválido se rechaza sin llamar a la red', async () => {
  const m = mockFetch(() => tokenRes());
  await rejectsUser(mk(m.fn).getTrack('../etc'), 400);
  await rejectsUser(mk(m.fn).getCollection('album', 'x'), 400);
  assert.equal(m.calls.length, 0);
});

// --- Álbumes ---

test('álbum: usa portada y nombre del padre y pagina tracks.next', async () => {
  const next = `https://api.spotify.com/v1/albums/${ID}/tracks?offset=2&limit=2`;
  const simple = (n: number) => {
    const { album: _a, external_ids: _e, ...rest } = trackJson(n);
    return rest;
  };
  const m = mockFetch((url) => {
    if (isToken(url)) return tokenRes();
    if (url === `https://api.spotify.com/v1/albums/${ID}`)
      return json({
        name: 'Mi Álbum',
        images: [{ url: 'https://cover/a' }],
        tracks: { items: [simple(1), simple(2)], next },
      });
    if (url === next) return json({ items: [simple(3)], next: null });
    return json({}, 500);
  });
  const col = await mk(m.fn).getCollection('album', ID);
  assert.equal(col.kind, 'album');
  assert.equal(col.title, 'Mi Álbum');
  assert.equal(col.coverUrl, 'https://cover/a');
  assert.deepEqual(
    col.tracks.map((t) => [t.title, t.album, t.coverUrl, t.isrc]),
    [1, 2, 3].map((n) => [`Canción ${n}`, 'Mi Álbum', 'https://cover/a', null]),
  );
});

// --- Playlists ---

const entry = (n: number, shape: 'item' | 'track', extra: Record<string, unknown> = {}) => ({
  [shape]: trackJson(n, extra),
});

function playlistHandler(opts: {
  shape: 'item' | 'track';
  endpoint: 'items' | 'tracks';
  other404?: number;
  pages: unknown[][];
}): Handler {
  const base = `https://api.spotify.com/v1/playlists/${ID2}`;
  const pageUrl = (i: number) => `${base}/${opts.endpoint}?offset=${i * 100}&limit=100`;
  return (url) => {
    if (isToken(url)) return tokenRes();
    if (url.startsWith(`${base}?`)) return json({ name: 'Mi Lista', images: [{ url: 'https://cover/p' }] });
    const otherEndpoint = opts.endpoint === 'items' ? 'tracks' : 'items';
    if (url.startsWith(`${base}/${otherEndpoint}`)) return json({}, opts.other404 ?? 404);
    if (url === `${base}/${opts.endpoint}?limit=100`) {
      return json({ items: opts.pages[0], next: opts.pages.length > 1 ? pageUrl(1) : null });
    }
    for (let i = 1; i < opts.pages.length; i++) {
      if (url === pageUrl(i)) return json({ items: opts.pages[i], next: i + 1 < opts.pages.length ? pageUrl(i + 1) : null });
    }
    return json({}, 500);
  };
}

test('playlist: /items con `item`, paginación y entradas inválidas omitidas', async () => {
  const m = mockFetch(
    playlistHandler({
      shape: 'item',
      endpoint: 'items',
      pages: [
        [entry(1, 'item'), null, { item: null }, entry(2, 'item', { is_local: true }), entry(3, 'item', { type: 'episode' })],
        [entry(4, 'item'), { item: { id: null, name: 'sin id' } }, entry(5, 'item')],
      ],
    }),
  );
  const col = await mk(m.fn).getCollection('playlist', ID2);
  assert.equal(col.kind, 'playlist');
  assert.equal(col.title, 'Mi Lista');
  assert.equal(col.coverUrl, 'https://cover/p');
  assert.deepEqual(col.tracks.map((t) => t.title), ['Canción 1', 'Canción 4', 'Canción 5']);
  // Cada pista usa la portada de su propio álbum.
  assert.equal(col.tracks[0]!.coverUrl, 'https://img/big');
  assert.ok(!m.apiCalls().some((c) => c.url.includes('/tracks?')));
});

test('playlist: cae a /tracks con `track` cuando /items da 404', async () => {
  const m = mockFetch(playlistHandler({ shape: 'track', endpoint: 'tracks', pages: [[entry(1, 'track'), entry(2, 'track')]] }));
  const col = await mk(m.fn).getCollection('playlist', ID2);
  assert.deepEqual(col.tracks.map((t) => t.title), ['Canción 1', 'Canción 2']);
  const urls = m.apiCalls().map((c) => c.url);
  assert.ok(urls.some((u) => u.includes('/items?')));
  assert.ok(urls.some((u) => u.includes('/tracks?')));
});

test('playlist: cae a /tracks también con 410', async () => {
  const m = mockFetch(
    playlistHandler({ shape: 'track', endpoint: 'tracks', other404: 410, pages: [[entry(1, 'track')]] }),
  );
  const col = await mk(m.fn).getCollection('playlist', ID2);
  assert.equal(col.tracks.length, 1);
});

test('playlist: maxTracks trunca y deja de paginar', async () => {
  const m = mockFetch(
    playlistHandler({
      shape: 'item',
      endpoint: 'items',
      pages: [
        [entry(1, 'item'), entry(2, 'item'), entry(3, 'item')],
        [entry(4, 'item'), entry(5, 'item')],
        [entry(6, 'item')],
      ],
    }),
  );
  const col = await mk(m.fn, { maxTracks: 4 }).getCollection('playlist', ID2);
  assert.deepEqual(col.tracks.map((t) => t.title), ['Canción 1', 'Canción 2', 'Canción 3', 'Canción 4']);
  assert.ok(!m.apiCalls().some((c) => c.url.includes('offset=200')));
});

test('playlist: 404 en la playlist es un error amigable', async () => {
  const m = mockFetch((url) => (isToken(url) ? tokenRes() : json({}, 404)));
  await rejectsUser(mk(m.fn).getCollection('playlist', ID2), 422, /No se encontró en Spotify/);
});

test('next que apunta a otro host no recibe el token', async () => {
  const m = mockFetch((url) => {
    if (isToken(url)) return tokenRes();
    if (url.includes('/albums/')) return json({ name: 'A', tracks: { items: [], next: 'https://evil.example/steal' } });
    return json({}, 500);
  });
  await rejectsUser(mk(m.fn).getCollection('album', ID), 502);
  assert.ok(!m.calls.some((c) => c.url.includes('evil.example')));
});

// --- Errores ---

test('errores: 404, 403, otros 5xx', async () => {
  const status = (s: number) => mk(mockFetch((url) => (isToken(url) ? tokenRes() : json({}, s))).fn).getTrack(ID);
  await rejectsUser(status(404), 422, /No se encontró en Spotify \(¿es privado o fue eliminado\?\)\./);
  await rejectsUser(status(403), 422, /no permite leer este contenido/);
  await rejectsUser(status(500), 502);
  await rejectsUser(status(418), 502);
});

test('errores: 429 con Retry-After corto se reintenta una vez', async () => {
  let hits = 0;
  const m = mockFetch((url) => {
    if (isToken(url)) return tokenRes();
    return ++hits === 1 ? json({}, 429, { 'retry-after': '0' }) : json(trackJson(1));
  });
  const t = await mk(m.fn).getTrack(ID);
  assert.equal(t.title, 'Canción 1');
  assert.equal(hits, 2);
});

test('errores: 429 persistente o con Retry-After largo', async () => {
  let hits = 0;
  const again = mockFetch((url) => (isToken(url) ? tokenRes() : (hits++, json({}, 429, { 'retry-after': '0' }))));
  await rejectsUser(mk(again.fn).getTrack(ID), 429, /limitando/);
  assert.equal(hits, 2);

  const long = mockFetch((url) => (isToken(url) ? tokenRes() : json({}, 429, { 'retry-after': '30' })));
  await rejectsUser(mk(long.fn).getTrack(ID), 429, /limitando/);
  assert.equal(long.apiCalls().length, 1);

  const none = mockFetch((url) => (isToken(url) ? tokenRes() : json({}, 429)));
  await rejectsUser(mk(none.fn).getTrack(ID), 429);
  assert.equal(none.apiCalls().length, 1);
});

test('errores: fallo de red -> 502', async () => {
  const apiDown = mockFetch((url) => {
    if (isToken(url)) return tokenRes();
    throw new TypeError('fetch failed');
  });
  await rejectsUser(mk(apiDown.fn).getTrack(ID), 502, /No se pudo conectar con Spotify\./);

  const tokenDown = mockFetch(() => {
    throw new TypeError('fetch failed');
  });
  await rejectsUser(mk(tokenDown.fn).getTrack(ID), 502, /No se pudo conectar con Spotify\./);
});
