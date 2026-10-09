import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-local-'));
const music = path.join(tmp, 'Musica');
process.env.DATA_DIR = path.join(tmp, 'data'); // antes de importar config
process.env.DOWNLOAD_DIR = music;
process.env.TUNEDROP_MODE = 'local';
const core = await import('../core');
const { buildApp } = await import('./app');

const PORT = 8787;
const HOST = `127.0.0.1:${PORT}`;
const track: TrackInfo = { id: 'a', title: 'Cancion a', artist: 'Artista', durationSec: 60, thumbnail: null, url: 'https://www.youtube.com/watch?v=a' };
const fake: Resolver = {
  name: 'youtube',
  canHandle: (u) => u.startsWith('https://fake.test/'),
  async resolve(u) {
    return { provider: 'youtube', kind: 'track', title: 'Cancion a', thumbnail: null, sourceUrl: u, tracks: [track] };
  },
  async download() {
    throw new Error('no usado');
  },
};

const opened: string[] = [];
const mk = (extra: Parameters<typeof buildApp>[0] = {}) =>
  buildApp({
    mode: 'local',
    port: PORT,
    resolvers: [fake],
    checkTools: async () => ({ ok: false, ytDlp: null, ffmpeg: false }),
    openFolder: (dir) => void opened.push(dir),
    ...extra,
  });

const dist = path.join(tmp, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');

let app: Awaited<ReturnType<typeof mk>>;
let server: Awaited<ReturnType<typeof mk>>;
before(async () => {
  app = await mk({ staticDir: dist });
  server = await buildApp({
    mode: 'server',
    resolvers: [fake],
    checkTools: async () => ({ ok: true, ytDlp: 'x', ffmpeg: true }),
    staticDir: null,
  });
  await app.ready();
  await server.ready();
});
after(async () => {
  await app.close();
  await server.close();
  core.getDb().close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

type Opts = { method?: 'GET' | 'POST' | 'PUT' | 'OPTIONS'; url: string; payload?: unknown; headers?: Record<string, string> };
/** Petición como la haría la propia interfaz (misma procedencia). */
const call = (o: Opts, a = app) =>
  a.inject({
    method: o.method ?? 'GET',
    url: o.url,
    payload: o.payload as object | undefined,
    headers: { host: HOST, ...o.headers },
  });

test('GET /api/config en modo local: modo, carpeta y sin clave de Turnstile', async () => {
  const res = await call({ url: '/api/config' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { mode: 'local', downloadDir: path.resolve(music), turnstileSiteKey: null });
});

test('GET /api/config en modo servidor: sin carpeta', async () => {
  const res = await server.inject({ url: '/api/config', headers: { 'cf-connecting-ip': '203.0.113.9' } });
  assert.deepEqual(res.json(), { mode: 'server', downloadDir: null, turnstileSiteKey: null });
});

test('/api/settings, /api/open-folder y descarga: solo existen en local; en servidor 404', async () => {
  const h = { 'cf-connecting-ip': '203.0.113.9' };
  assert.equal((await server.inject({ url: '/api/settings', headers: h })).statusCode, 404);
  assert.equal((await server.inject({ method: 'PUT', url: '/api/settings', payload: { downloadDir: music }, headers: h })).statusCode, 404);
  assert.equal((await server.inject({ method: 'POST', url: '/api/open-folder', payload: {}, headers: h })).statusCode, 404);
});

test('modo local: no hay descarga por navegador (404 con error)', async () => {
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 't', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  const res = await call({ url: `/api/jobs/${id}/download` });
  assert.equal(res.statusCode, 404);
  assert.ok(typeof res.json().error === 'string');
});

test('GET/PUT /api/settings: valida, crea la carpeta, persiste y responde en español', async () => {
  assert.deepEqual((await call({ url: '/api/settings' })).json(), { downloadDir: path.resolve(music) });

  const next = path.join(tmp, 'Otra', 'Carpeta');
  const ok = await call({ method: 'PUT', url: '/api/settings', payload: { downloadDir: next } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { downloadDir: path.resolve(next) });
  assert.ok(fs.statSync(next).isDirectory());
  assert.equal(core.readSettings(core.config.dataDir).downloadDir, path.resolve(next));
  assert.deepEqual((await call({ url: '/api/settings' })).json(), { downloadDir: path.resolve(next) });
  assert.equal((await call({ url: '/api/config' })).json().downloadDir, path.resolve(next));

  for (const downloadDir of ['', 'relativa', path.parse(tmp).root, 5, null, undefined]) {
    const bad = await call({ method: 'PUT', url: '/api/settings', payload: { downloadDir } });
    assert.equal(bad.statusCode, 400, String(downloadDir));
    assert.equal(typeof bad.json().error, 'string');
  }
  // el ajuste válido anterior se conserva tras los rechazos
  assert.equal(core.readSettings(core.config.dataDir).downloadDir, path.resolve(next));

  // vuelve a la carpeta de pruebas para el resto
  await call({ method: 'PUT', url: '/api/settings', payload: { downloadDir: music } });
});

test('POST /api/jobs en local: sin Turnstile, sin topes ni límites por IP; savedTo empieza en null', async () => {
  let id = '';
  for (let i = 0; i < 40; i++) {
    const res = await call({ method: 'POST', url: '/api/jobs', payload: { url: 'https://fake.test/x', format: 'mp3' } });
    assert.equal(res.statusCode, 200, `intento ${i}`);
    assert.equal(res.headers['x-ratelimit-limit'], undefined);
    id = res.json().id;
  }
  const state = (await call({ url: `/api/jobs/${id}` })).json();
  assert.equal(state.savedTo, null);
  // no se guarda ninguna huella de IP en local
  assert.equal(core.getJobRow(id)?.client_key, null);
});

test('savedTo aparece en el estado del trabajo cuando se registra la carpeta', async () => {
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 'Lista', kind: 'playlist', format: 'mp3', thumbnail: null, tracks: [track] });
  core.setJobSavedTo(id, path.join(music, 'Lista'));
  assert.equal((await call({ url: `/api/jobs/${id}` })).json().savedTo, path.join(music, 'Lista'));
});

test('POST /api/open-folder: abre la carpeta de música, o la del trabajo, solo dentro de la carpeta de música', async () => {
  opened.length = 0;
  const real = (p: string) => fs.realpathSync(p);

  // sin jobId: la carpeta de música (se crea si falta)
  const root = await call({ method: 'POST', url: '/api/open-folder', payload: {} });
  assert.equal(root.statusCode, 200);
  assert.deepEqual(root.json(), { ok: true });
  assert.deepEqual(opened, [real(music)]);

  // con jobId de un trabajo cuya carpeta está dentro
  const sub = path.join(music, 'Lista');
  fs.mkdirSync(sub, { recursive: true });
  const inside = crypto.randomUUID();
  core.createJob({ id: inside, provider: 'youtube', sourceUrl: 'https://x', title: 'Lista', kind: 'playlist', format: 'mp3', thumbnail: null, tracks: [track] });
  core.setJobSavedTo(inside, sub);
  const res = await call({ method: 'POST', url: '/api/open-folder', payload: { jobId: inside } });
  assert.equal(res.statusCode, 200);
  assert.equal(opened.at(-1), real(sub));

  // una carpeta fuera de la de música (p. ej. si el ajuste cambió) no se abre
  const outside = path.join(tmp, 'fuera');
  fs.mkdirSync(outside, { recursive: true });
  const out = crypto.randomUUID();
  core.createJob({ id: out, provider: 'youtube', sourceUrl: 'https://x', title: 'x', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  core.setJobSavedTo(out, outside);
  const before = opened.length;
  const denied = await call({ method: 'POST', url: '/api/open-folder', payload: { jobId: out } });
  assert.equal(denied.statusCode, 400);
  assert.equal(typeof denied.json().error, 'string');

  // un prefijo de texto no es contención: "Musica-otra" no está dentro de "Musica"
  const sibling = `${music}-otra`;
  fs.mkdirSync(sibling, { recursive: true });
  const sib = crypto.randomUUID();
  core.createJob({ id: sib, provider: 'youtube', sourceUrl: 'https://x', title: 'x', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  core.setJobSavedTo(sib, sibling);
  assert.equal((await call({ method: 'POST', url: '/api/open-folder', payload: { jobId: sib } })).statusCode, 400);

  // trabajo sin carpeta aún, inexistente, o identificador mal formado
  const none = crypto.randomUUID();
  core.createJob({ id: none, provider: 'youtube', sourceUrl: 'https://x', title: 'x', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  assert.equal((await call({ method: 'POST', url: '/api/open-folder', payload: { jobId: none } })).statusCode, 404);
  assert.equal((await call({ method: 'POST', url: '/api/open-folder', payload: { jobId: crypto.randomUUID() } })).statusCode, 404);
  for (const jobId of ['../../etc', 'nope', 7, {}]) {
    assert.equal((await call({ method: 'POST', url: '/api/open-folder', payload: { jobId } })).statusCode, 400, JSON.stringify(jobId));
  }
  assert.equal(opened.length, before, 'ninguna petición rechazada abrió nada');
});

test('open-folder: si el sistema no puede abrir la carpeta responde un error claro', async () => {
  const failing = await mk({
    openFolder: () => {
      throw new Error('no hay explorador');
    },
  });
  const res = await failing.inject({ method: 'POST', url: '/api/open-folder', payload: {}, headers: { host: HOST } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, 'No se pudo abrir la carpeta.');
  await failing.close();
});

// ---------------------------------------------------------------------------
// Protecciones de la app local frente a webs externas
// ---------------------------------------------------------------------------

test('Host: se rechaza cualquier Host que no sea loopback con el puerto real (DNS rebinding)', async () => {
  for (const host of ['evil.example', 'evil.example:8787', '127.0.0.1', '127.0.0.1:9999', 'localhost:80', '192.168.1.20:8787']) {
    for (const url of ['/api/config', '/api/health', '/']) {
      const res = await app.inject({ url, headers: { host } });
      assert.equal(res.statusCode, 403, `${host} ${url}`);
      assert.deepEqual(res.json(), { error: 'Petición no permitida.' });
    }
  }
  for (const host of ['127.0.0.1:8787', 'localhost:8787', '[::1]:8787']) {
    assert.equal((await app.inject({ url: '/api/config', headers: { host } })).statusCode, 200, host);
  }
  // la interfaz con el Host correcto sí se sirve
  assert.equal((await call({ url: '/' })).statusCode, 200);
});

test('Origin: en /api solo se acepta el origen propio', async () => {
  const get = (origin?: string) => call({ url: '/api/config', headers: origin === undefined ? {} : { origin } });
  assert.equal((await get()).statusCode, 200);
  assert.equal((await get(`http://${HOST}`)).statusCode, 200);
  for (const origin of ['https://evil.example', 'http://evil.example:8787', 'null', `https://${HOST}`, 'http://localhost:8787']) {
    assert.equal((await get(origin)).statusCode, 403, origin);
  }
  // también en las rutas que escriben
  const post = await call({ method: 'POST', url: '/api/jobs', payload: { url: 'https://fake.test/x' }, headers: { origin: 'https://evil.example' } });
  assert.equal(post.statusCode, 403);
  const put = await call({ method: 'PUT', url: '/api/settings', payload: { downloadDir: music }, headers: { origin: 'https://evil.example' } });
  assert.equal(put.statusCode, 403);
  const open = await call({ method: 'POST', url: '/api/open-folder', payload: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(open.statusCode, 403);
});

test('Sec-Fetch-Site: solo same-origin o none', async () => {
  const get = (site: string) => call({ url: '/api/config', headers: { 'sec-fetch-site': site } });
  assert.equal((await get('same-origin')).statusCode, 200);
  assert.equal((await get('none')).statusCode, 200);
  assert.equal((await get('same-site')).statusCode, 403);
  assert.equal((await get('cross-site')).statusCode, 403);
  // un GET de otra web (p. ej. EventSource/fetch no-cors) a un trabajo real tampoco pasa
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 't', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  assert.equal((await call({ url: `/api/jobs/${id}/events`, headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
});

test('los POST y PUT siguen exigiendo application/json', async () => {
  for (const [method, url] of [['POST', '/api/jobs'], ['POST', '/api/open-folder'], ['PUT', '/api/settings']] as const) {
    const res = await app.inject({ method, url, payload: 'a=1', headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.statusCode, 415, `${method} ${url}`);
    const plain = await app.inject({ method, url, payload: '{}', headers: { host: HOST, 'content-type': 'text/plain' } });
    assert.equal(plain.statusCode, 415, `${method} ${url} text/plain`);
  }
});

test('sin CORS: ninguna respuesta lleva cabeceras Access-Control-* y el preflight de otra web es 403', async () => {
  const same = await call({ url: '/api/config', headers: { origin: `http://${HOST}` } });
  const cross = await call({ url: '/api/config', headers: { origin: 'https://evil.example' } });
  const preflight = await call({
    method: 'OPTIONS',
    url: '/api/jobs',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  for (const res of [same, cross, preflight]) {
    assert.deepEqual(Object.keys(res.headers).filter((k) => k.startsWith('access-control-')), []);
  }
  assert.equal(preflight.statusCode, 403);
  assert.equal(cross.statusCode, 403);
});
