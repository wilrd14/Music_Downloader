// Pruebas de las correcciones de la auditoría de seguridad (2026-10-09). Ver docs/security.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Limits, Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-hardening-'));
process.env.DATA_DIR = path.join(tmp, 'data'); // antes de importar config
process.env.DOWNLOAD_DIR = path.join(tmp, 'music');
process.env.TUNEDROP_MODE = 'server';
const core = await import('../core');
const { buildApp, FRONTEND_CSP, FRONTEND_CSP_LOCAL } = await import('./app');
const { isApiRequest } = await import('./localGuard');

const track: TrackInfo = { id: 'a', title: 'Cancion a', artist: 'Artista', durationSec: 60, thumbnail: null, url: 'https://www.youtube.com/watch?v=a' };
let resolveCalls = 0;
let gate: Promise<void> | null = null;
const fake: Resolver = {
  name: 'youtube',
  canHandle: (u) => u.startsWith('https://fake.test/'),
  async resolve(u) {
    resolveCalls++;
    if (gate) await gate;
    return { provider: 'youtube', kind: 'track', title: 'Cancion a', thumbnail: null, sourceUrl: u, tracks: [track] };
  },
  async download() {
    throw new Error('no usado');
  },
};

const roomy: Partial<Limits> = {
  rateGeneralPerMin: 10_000,
  rateResolvePerMin: 10_000,
  rateJobsPerMin: 10_000,
  rateDownloadPerMin: 10_000,
  maxQueuedJobs: 10_000,
  maxActiveJobsPerIp: 10_000,
  turnstileSecretKey: null,
  turnstileSiteKey: null,
};

type App = Awaited<ReturnType<typeof buildApp>>;
const apps: App[] = [];
async function mk(over: Partial<Limits> = {}, extra: Parameters<typeof buildApp>[0] = {}): Promise<App> {
  const app = await buildApp({
    resolvers: [fake],
    checkTools: async () => ({ ok: true, ytDlp: 'x', ffmpeg: true }),
    diskUsage: () => 0,
    limits: { ...roomy, ...over },
    ...extra,
  });
  apps.push(app);
  await app.ready();
  return app;
}

after(async () => {
  for (const a of apps) await a.close();
  core.getDb().close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

// --- Modo local: la ruta con %xx no esquiva las comprobaciones de Origin / Sec-Fetch-Site ---------------------------

const PORT = 8787;
const HOST = `127.0.0.1:${PORT}`;
const cross = { host: HOST, origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' };

test('isApiRequest: reconoce /api también con %xx, mayúsculas o la ruta enrutada', () => {
  for (const url of ['/api/settings', '/%61pi/settings', '/%61%70%69/settings', '/api%2Fsettings', '/API/settings', '/api', '/api?x=1', '/api/x#y']) {
    assert.equal(isApiRequest(url), true, url);
  }
  assert.equal(isApiRequest('/loquesea', '/api/settings'), true);
  for (const url of ['/', '/assets/app.js', '/apix', '/miapi/x', '/%zz']) assert.equal(isApiRequest(url), false, url);
});

test('modo local: /%61pi/settings desde otra web se rechaza igual que /api/settings (antes devolvía 200)', async () => {
  const app = await mk({}, { mode: 'local', port: PORT, staticDir: null });
  for (const url of ['/api/settings', '/%61pi/settings', '/api%2Fsettings']) {
    const bad = await app.inject({ url, headers: cross });
    assert.notEqual(bad.statusCode, 200, url);
    assert.equal(bad.statusCode, url === '/api%2Fsettings' ? bad.statusCode : 403, url);
  }
  const bad = await app.inject({ url: '/%61pi/settings', headers: { host: HOST, 'sec-fetch-site': 'cross-site' } });
  assert.equal(bad.statusCode, 403);
  const withOrigin = await app.inject({ url: '/%61pi/settings', headers: { host: HOST, origin: 'http://evil.test' } });
  assert.equal(withOrigin.statusCode, 403);
  // la interfaz legítima sigue funcionando por las dos formas
  const same = { host: HOST, origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' };
  assert.equal((await app.inject({ url: '/api/settings', headers: same })).statusCode, 200);
  assert.equal((await app.inject({ url: '/%61pi/settings', headers: same })).statusCode, 200);
});

test('modo local: la CSP de la interfaz no abre ningún origen de Cloudflare; en servidor sí (Turnstile)', async () => {
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  const local = await mk({}, { mode: 'local', port: PORT, staticDir: dist });
  const server = await mk({}, { mode: 'server', staticDir: dist });
  const l = String((await local.inject({ url: '/', headers: { host: HOST } })).headers['content-security-policy']);
  const s = String((await server.inject({ url: '/' })).headers['content-security-policy']);
  assert.equal(l, FRONTEND_CSP_LOCAL);
  assert.equal(s, FRONTEND_CSP);
  assert.doesNotMatch(l, /cloudflare/);
  assert.match(l, /script-src 'self';/);
  assert.match(l, /frame-src 'none';/);
  assert.match(s, /challenges\.cloudflare\.com/);
});

test('las respuestas de la API no se guardan en cachés (Cache-Control: no-store)', async () => {
  const app = await mk();
  for (const url of ['/api/health', '/api/config', '/api/nada']) {
    const res = await app.inject({ url });
    assert.equal(res.headers['cache-control'], 'no-store', url);
  }
});

// --- Límites por IP: IPv6 /64 e IPv4 mapeada ----------------------------------------------------------------------

const post = (app: App, ip: string, url: string, n = 1) =>
  app.inject({ method: 'POST', url: `/api/resolve`, headers: { 'cf-connecting-ip': ip }, payload: { url: `https://fake.test/${url}${n}` } });

test('rate limit: rotar de dirección dentro de un /64 IPv6 no evita el límite', async () => {
  const app = await mk({ rateResolvePerMin: 3 });
  const codes: number[] = [];
  for (let i = 1; i <= 6; i++) codes.push((await post(app, `2001:db8:aaaa:bbbb::${i.toString(16)}`, 'v6', i)).statusCode);
  assert.deepEqual(codes, [200, 200, 200, 429, 429, 429]);
  // otro /64 es otro cliente
  assert.equal((await post(app, '2001:db8:aaaa:cccc::1', 'v6', 9)).statusCode, 200);
});

test('rate limit: la IPv4 y su forma mapeada ::ffff:a.b.c.d cuentan como el mismo cliente', async () => {
  const app = await mk({ rateResolvePerMin: 2 });
  const codes: number[] = [];
  for (const ip of ['203.0.113.99', '::ffff:203.0.113.99', '203.0.113.99', '::FFFF:cb00:7163']) codes.push((await post(app, ip, 'v4', codes.length)).statusCode);
  assert.deepEqual(codes, [200, 200, 429, 429]);
});

test('tope por cliente: el /64 completo comparte el límite de descargas activas', async () => {
  const app = await mk({ maxActiveJobsPerIp: 2 });
  const job = (ip: string) => app.inject({ method: 'POST', url: '/api/jobs', headers: { 'cf-connecting-ip': ip }, payload: { url: 'https://fake.test/job' } });
  assert.equal((await job('2001:db8:1:2::1')).statusCode, 200);
  assert.equal((await job('2001:db8:1:2::2')).statusCode, 200);
  assert.equal((await job('2001:db8:1:2:abcd::3')).statusCode, 429);
});

// --- Cola de resolución: caché acotada, peticiones iguales compartidas y tope de procesos ---------------------------

test('resolve: peticiones simultáneas iguales comparten una sola consulta a yt-dlp', async () => {
  const app = await mk();
  resolveCalls = 0;
  let open!: () => void;
  gate = new Promise<void>((r) => (open = r));
  const reqs = Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: '/api/resolve', payload: { url: 'https://fake.test/same' } }));
  await new Promise((r) => setTimeout(r, 50)); // deja que las 5 lleguen al servidor
  open();
  gate = null;
  const res = await Promise.all(reqs);
  assert.ok(res.every((r) => r.statusCode === 200));
  assert.equal(resolveCalls, 1);
});

test('resolve: más consultas simultáneas distintas que MAX_CONCURRENT_RESOLVES reciben 503 con Retry-After', async () => {
  const app = await mk({ maxConcurrentResolves: 2 });
  let open!: () => void;
  gate = new Promise<void>((r) => (open = r));
  const reqs = ['a', 'b', 'c', 'd'].map((x) => app.inject({ method: 'POST', url: '/api/resolve', payload: { url: `https://fake.test/${x}` } }));
  // Las dos que no caben responden enseguida (503); las otras dos esperan a la puerta. Se abre cuando ya han respondido las rechazadas.
  const early: number[] = [];
  reqs.forEach((p) => void p.then((r) => early.push(r.statusCode)));
  for (let i = 0; i < 200 && early.length < 2; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(early, [503, 503]);
  open();
  gate = null;
  const res = await Promise.all(reqs);
  const codes = res.map((r) => r.statusCode).sort();
  assert.deepEqual(codes, [200, 200, 503, 503]);
  assert.ok(res.filter((r) => r.statusCode === 503).every((r) => r.headers['retry-after']));
  // pasada la ráfaga, vuelve a aceptar
  assert.equal((await app.inject({ method: 'POST', url: '/api/resolve', payload: { url: 'https://fake.test/e' } })).statusCode, 200);
});

test('resolve: un enlace no soportado no ocupa ningún hueco de proceso', async () => {
  const app = await mk({ maxConcurrentResolves: 1 });
  for (let i = 0; i < 5; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/resolve', payload: { url: `https://example.com/${i}` } });
    assert.equal(res.statusCode, 400);
  }
});

test('resolve: la caché está acotada (los más antiguos se descartan)', async () => {
  const app = await mk();
  resolveCalls = 0;
  const ask = (n: number) => app.inject({ method: 'POST', url: '/api/resolve', payload: { url: `https://fake.test/cache${n}` } });
  for (let i = 0; i < 230; i++) assert.equal((await ask(i)).statusCode, 200);
  assert.equal(resolveCalls, 230);
  await ask(229); // reciente: sigue en caché
  assert.equal(resolveCalls, 230);
  await ask(0); // el más antiguo ya no está: vuelve a consultar
  assert.equal(resolveCalls, 231);
});

// --- SSE: tope de conexiones ----------------------------------------------------------------------------------------

async function openSse(address: string, id: string, ip: string) {
  const ac = new AbortController();
  const res = await fetch(`${address}/api/jobs/${id}/events`, { headers: { 'cf-connecting-ip': ip }, signal: ac.signal });
  return { res, close: () => ac.abort() };
}

test('SSE: tope por cliente (429 al pasarse) y se libera al cerrar la conexión', async () => {
  const app = await mk({ maxSsePerIp: 2, maxSseTotal: 100 });
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 't', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const a = await openSse(address, id, '203.0.113.50');
  const b = await openSse(address, id, '203.0.113.50');
  assert.equal(a.res.status, 200);
  assert.equal(b.res.status, 200);
  const c = await openSse(address, id, '203.0.113.50');
  assert.equal(c.res.status, 429);
  assert.ok(c.res.headers.get('retry-after'));
  assert.equal(c.res.headers.get('cache-control'), 'no-store');
  // otro cliente no se ve afectado
  const other = await openSse(address, id, '203.0.113.51');
  assert.equal(other.res.status, 200);
  // al cerrar una conexión se libera el hueco (el servidor se entera de forma asíncrona: se reintenta)
  a.close();
  let status = 429;
  for (let i = 0; i < 50 && status === 429; i++) {
    await new Promise((r) => setTimeout(r, 40));
    const again = await openSse(address, id, '203.0.113.50');
    status = again.res.status;
    if (status === 200) again.close();
  }
  assert.equal(status, 200);
  b.close();
  other.close();
});

test('SSE: la cabecera Cache-Control del flujo no se duplica y es no-cache', async () => {
  const app = await mk({ maxSsePerIp: 5 });
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 't', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const s = await openSse(address, id, '203.0.113.60');
  assert.equal(s.res.status, 200);
  assert.equal(s.res.headers.get('cache-control'), 'no-cache, no-transform');
  assert.match(String(s.res.headers.get('content-type')), /text\/event-stream/);
  s.close();
});

test('SSE: el tope total también se aplica', async () => {
  const app = await mk({ maxSsePerIp: 50, maxSseTotal: 2 });
  const id = crypto.randomUUID();
  core.createJob({ id, provider: 'youtube', sourceUrl: 'https://x', title: 't', kind: 'track', format: 'mp3', thumbnail: null, tracks: [track] });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const open = [await openSse(address, id, '203.0.113.70'), await openSse(address, id, '203.0.113.71')];
  assert.deepEqual(open.map((o) => o.res.status), [200, 200]);
  assert.equal((await openSse(address, id, '203.0.113.72')).res.status, 429);
  open.forEach((o) => o.close());
});
