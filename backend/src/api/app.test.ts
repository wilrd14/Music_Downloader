import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-api-'));
process.env.DATA_DIR = tmp; // antes de importar config
const core = await import('../core');
const { UserError } = core;
const { buildApp } = await import('./app');

const tracks: TrackInfo[] = ['a', 'b', 'c'].map((id) => ({
  id,
  title: `Cancion ${id}`,
  artist: 'Artista',
  durationSec: 60,
  thumbnail: null,
  url: `https://www.youtube.com/watch?v=${id}`,
}));

let resolveCalls = 0;
const fake: Resolver = {
  name: 'youtube',
  canHandle: (u) => u.startsWith('https://fake.test/'),
  async resolve(u) {
    resolveCalls++;
    if (u.endsWith('/boom')) throw new Error('secreto interno');
    if (u.endsWith('/playlist')) {
      return { provider: 'youtube', kind: 'playlist', title: 'Lista: "rara"/ñ', thumbnail: null, sourceUrl: u, tracks };
    }
    return { provider: 'youtube', kind: 'track', title: 'Cancion a', thumbnail: null, sourceUrl: u, tracks: [tracks[0]!] };
  },
  async download() {
    throw new Error('no usado');
  },
};

const app = await buildApp({
  resolvers: [fake],
  checkTools: async () => ({ ok: false, ytDlp: null, ffmpeg: false }),
});

before(async () => {
  await app.ready();
});
after(async () => {
  await app.close();
  core.getDb().close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

test('GET /api/health no falla sin yt-dlp ni ffmpeg', async () => {
  const res = await app.inject('/api/health');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: false, ytDlp: null, ffmpeg: false });
});

test('POST /api/resolve valida la entrada con mensajes en español', async () => {
  for (const body of [{}, { url: '' }, { url: 42 }, { url: ['x'] }]) {
    const res = await post('/api/resolve', body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json().error, 'Pega un enlace.');
  }
  const bad = await post('/api/resolve', { url: 'https://example.com/x' });
  assert.equal(bad.statusCode, 400);
  assert.match(bad.json().error, /no soportado/);

  const malformed = await app.inject({
    method: 'POST',
    url: '/api/resolve',
    headers: { 'content-type': 'application/json' },
    payload: '{no json',
  });
  assert.equal(malformed.statusCode, 400);
  assert.ok(malformed.json().error);
});

test('POST /api/resolve devuelve la fuente y usa caché', async () => {
  const before = resolveCalls;
  const r1 = await post('/api/resolve', { url: ' https://fake.test/playlist ' });
  assert.equal(r1.statusCode, 200);
  assert.equal(r1.json().tracks.length, 3);
  assert.equal(r1.json().maxTracksPerJob, core.config.maxTracksPerJob);
  await post('/api/resolve', { url: 'https://fake.test/playlist' });
  assert.equal(resolveCalls - before, 1);
});

test('errores inesperados no filtran detalles', async () => {
  const res = await post('/api/resolve', { url: 'https://fake.test/boom' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, 'Error interno del servidor.');
});

test('POST /api/jobs valida y crea el trabajo', async () => {
  assert.equal((await post('/api/jobs', { url: 'https://fake.test/playlist', format: 'wav' })).statusCode, 400);
  assert.equal((await post('/api/jobs', {})).statusCode, 400);
  const none = await post('/api/jobs', { url: 'https://fake.test/playlist', trackIds: ['zzz'] });
  assert.equal(none.statusCode, 400);
  assert.match(none.json().error, /al menos una/);

  const res = await post('/api/jobs', { url: 'https://fake.test/playlist', trackIds: ['a', 'c'], format: 'm4a' });
  assert.equal(res.statusCode, 200);
  const { id } = res.json();
  const state = (await app.inject(`/api/jobs/${id}`)).json();
  assert.equal(state.status, 'queued');
  assert.equal(state.format, 'm4a');
  assert.deepEqual(state.tracks.map((t: { id: string }) => t.id), ['a', 'c']);
  assert.equal(state.queuePosition >= 1, true);
});

test('GET /api/jobs/:id y /download con id desconocido -> 404', async () => {
  for (const u of ['/api/jobs/nope', '/api/jobs/nope/download', '/api/jobs/nope/events']) {
    const res = await app.inject(u);
    assert.equal(res.statusCode, 404, u);
    assert.equal(res.json().error, 'Descarga no encontrada.');
  }
});

function makeJob(id: string, kind: 'track' | 'playlist', title: string, files: Record<string, string>) {
  const dir = path.join(tmp, 'jobs', id);
  fs.mkdirSync(dir, { recursive: true });
  const names = Object.keys(files);
  core.createJob({
    id,
    provider: 'youtube',
    sourceUrl: 'https://fake.test/x',
    title,
    kind,
    format: 'mp3',
    thumbnail: null,
    tracks: names.map((n, i) => ({ ...tracks[i % 3]!, id: `${id}-${i}` })),
  });
  core.claimNextJob();
  names.forEach((n, i) => {
    const p = path.join(dir, n);
    fs.writeFileSync(p, files[n]!);
    core.updateTrack(id, i, { status: 'done', progress: 100, file_path: p });
  });
}

test('download: 409 si no está listo, archivo único, ZIP y 410 si expiró', async () => {
  core.createJob({
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'youtube',
    sourceUrl: 'x',
    title: 'p',
    kind: 'track',
    format: 'mp3',
    thumbnail: null,
    tracks: [tracks[0]!],
  });
  assert.equal((await app.inject('/api/jobs/11111111-1111-4111-8111-111111111111/download')).statusCode, 409);

  makeJob('22222222-2222-4222-8222-222222222222', 'track', 'Cancion', { 'Artista - Canción ñ.mp3': 'AUDIO' });
  core.finishJob('22222222-2222-4222-8222-222222222222', 'done');
  const single = await app.inject('/api/jobs/22222222-2222-4222-8222-222222222222/download');
  assert.equal(single.statusCode, 200);
  assert.equal(single.headers['content-type'], 'audio/mpeg');
  assert.equal(single.body, 'AUDIO');
  const cd = String(single.headers['content-disposition']);
  assert.match(cd, /^attachment; filename="Artista - Canci_n _\.mp3"; filename\*=UTF-8''Artista%20-%20Canci%C3%B3n%20%C3%B1\.mp3$/);

  makeJob('33333333-3333-4333-8333-333333333333', 'playlist', 'Lista: "rara"', { '1 - A.mp3': 'AAAA', '2 - B.mp3': 'BBBB' });
  core.finishJob('33333333-3333-4333-8333-333333333333', 'done');
  const zip = await app.inject('/api/jobs/33333333-3333-4333-8333-333333333333/download');
  assert.equal(zip.statusCode, 200);
  assert.equal(zip.headers['content-type'], 'application/zip');
  assert.match(String(zip.headers['content-disposition']), /filename="Lista_ _rara_\.zip"/);
  const buf = zip.rawPayload;
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const text = buf.toString('latin1');
  assert.ok(text.includes('Lista_ _rara_/1 - A.mp3') && text.includes('Lista_ _rara_/2 - B.mp3'));
  assert.ok(text.includes('AAAA') && text.includes('BBBB')); // almacenado sin comprimir

  // si falta un archivo en disco solo se omite ese
  fs.rmSync(path.join(tmp, 'jobs', '33333333-3333-4333-8333-333333333333', '1 - A.mp3'));
  const partial = await app.inject('/api/jobs/33333333-3333-4333-8333-333333333333/download');
  assert.equal(partial.statusCode, 200);
  assert.ok(!partial.rawPayload.toString('latin1').includes('1 - A.mp3'));

  core.markExpired('33333333-3333-4333-8333-333333333333');
  const gone = await app.inject('/api/jobs/33333333-3333-4333-8333-333333333333/download');
  assert.equal(gone.statusCode, 410);
});

test('seguridad: cabeceras en las respuestas', async () => {
  const res = await app.inject('/api/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('seguridad: POST que no es JSON -> 415', async () => {
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
    const res = await app.inject({ method: 'POST', url: '/api/resolve', headers: { 'content-type': type }, payload: 'url=x' });
    assert.equal(res.statusCode, 415, type);
  }
});

test('seguridad: ids que no son UUID se rechazan sin consultar (404)', async () => {
  for (const id of ['..%2F..%2Fetc', 'x', '1;%20DROP%20TABLE%20jobs', '33333333-3333-4333-8333-33333333333']) {
    for (const suffix of ['', '/download', '/events']) {
      const url = '/api/jobs/' + id + suffix;
      assert.equal((await app.inject(url)).statusCode, 404, url);
    }
  }
});

test('seguridad: no se sirven archivos fuera de la carpeta de trabajos', async () => {
  const id = '66666666-6666-4666-8666-666666666666';
  const outside = path.join(tmp, 'secreto.mp3');
  fs.writeFileSync(outside, 'no debe salir');
  core.createJob({ id, provider: 'youtube', sourceUrl: 'x', title: 'F', kind: 'track', format: 'mp3', thumbnail: null, tracks: [tracks[0]!] });
  core.claimNextJob();
  core.updateTrack(id, 0, { status: 'done', progress: 100, file_path: outside });
  core.finishJob(id, 'done');
  const res = await app.inject('/api/jobs/' + id + '/download');
  assert.equal(res.statusCode, 409);
  assert.ok(!res.body.includes('no debe salir'));
});

test('SSE: envía el estado y cierra al terminar; no deja temporizadores si el cliente se va', async () => {
  makeJob('44444444-4444-4444-8444-444444444444', 'track', 'S', { 'x.mp3': 'x' });
  core.finishJob('44444444-4444-4444-8444-444444444444', 'done');
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  const res = await fetch(`${address}/api/jobs/44444444-4444-4444-8444-444444444444/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = await res.text(); // termina porque el trabajo ya está done
  assert.match(body, /^data: .*"status":"done"/);

  // cliente que se desconecta a mitad de un trabajo en curso
  core.createJob({
    id: '55555555-5555-4555-8555-555555555555',
    provider: 'youtube',
    sourceUrl: 'x',
    title: 'a',
    kind: 'track',
    format: 'mp3',
    thumbnail: null,
    tracks: [tracks[0]!],
  });
  const ctl = new AbortController();
  const live = await fetch(`${address}/api/jobs/55555555-5555-4555-8555-555555555555/events`, { signal: ctl.signal });
  const reader = live.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"status":"queued"/);
  ctl.abort();
  await reader.read().catch(() => undefined);
  // el cierre del servidor no debe colgarse por conexiones SSE huérfanas
  await app.close();
});
