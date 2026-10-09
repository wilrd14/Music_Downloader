import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, test } from 'node:test';
import type { Limits, Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-limits-'));
process.env.DATA_DIR = tmp; // antes de importar config
process.env.TUNEDROP_MODE = 'server'; // estas pruebas cubren el modo servidor (límites por IP, Turnstile...)
const core = await import('../core');
const { buildApp } = await import('./app');

const track: TrackInfo = {
  id: 'a',
  title: 'Cancion a',
  artist: 'Artista',
  durationSec: 60,
  thumbnail: null,
  url: 'https://www.youtube.com/watch?v=a',
};
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

// Límites holgados por defecto para que cada prueba ajuste solo lo que mide.
const roomy: Partial<Limits> = {
  rateGeneralPerMin: 1000,
  rateResolvePerMin: 1000,
  rateJobsPerMin: 1000,
  rateDownloadPerMin: 1000,
  maxQueuedJobs: 1000,
  maxActiveJobsPerIp: 1000,
  turnstileSecretKey: null,
  turnstileSiteKey: null,
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function mkApp(over: Partial<Limits> = {}, extra: Parameters<typeof buildApp>[0] = {}) {
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

beforeEach(() => {
  core.getDb().exec('DELETE FROM jobs');
});
after(async () => {
  for (const a of apps) await a.close();
  core.getDb().close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

const body = { url: 'https://fake.test/a' };
const from = (app: Awaited<ReturnType<typeof buildApp>>, ip: string, url: string, payload: object) =>
  app.inject({ method: 'POST', url, headers: { 'cf-connecting-ip': ip }, payload });

// --- Rate limiting ---------------------------------------------------------

test('rate limit: /api/resolve devuelve 429 en español con Retry-After, por IP', async () => {
  const app = await mkApp({ rateResolvePerMin: 2 });
  assert.equal((await from(app, '203.0.113.1', '/api/resolve', body)).statusCode, 200);
  assert.equal((await from(app, '203.0.113.1', '/api/resolve', body)).statusCode, 200);
  const limited = await from(app, '203.0.113.1', '/api/resolve', body);
  assert.equal(limited.statusCode, 429);
  assert.match(limited.json().error, /Demasiadas peticiones/);
  assert.ok(Number(limited.headers['retry-after']) >= 1);
  // otra IP (según CF-Connecting-IP) tiene su propio contador
  assert.equal((await from(app, '203.0.113.2', '/api/resolve', body)).statusCode, 200);
});

test('rate limit: POST /api/jobs tiene su propio límite', async () => {
  const app = await mkApp({ rateJobsPerMin: 1 });
  assert.equal((await from(app, '203.0.113.3', '/api/jobs', body)).statusCode, 200);
  const limited = await from(app, '203.0.113.3', '/api/jobs', body);
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.headers['retry-after']);
});

test('rate limit: descargas tienen su propio límite (404 cuenta igual que cualquier otra respuesta)', async () => {
  const app = await mkApp({ rateDownloadPerMin: 1 });
  const url = '/api/jobs/11111111-1111-4111-8111-111111111111/download';
  const get = () => app.inject({ method: 'GET', url, headers: { 'cf-connecting-ip': '203.0.113.4' } });
  assert.equal((await get()).statusCode, 404);
  assert.equal((await get()).statusCode, 429);
});

test('rate limit: el límite general aplica a /api/* pero no a archivos estáticos', async () => {
  const dist = path.join(tmp, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  const app = await mkApp({ rateGeneralPerMin: 2 }, { staticDir: dist });
  const get = (u: string) => app.inject({ method: 'GET', url: u, headers: { 'cf-connecting-ip': '203.0.113.5' } });
  assert.equal((await get('/api/config')).statusCode, 200);
  assert.equal((await get('/api/config')).statusCode, 200);
  assert.equal((await get('/api/config')).statusCode, 429);
  for (let i = 0; i < 5; i++) assert.equal((await get('/')).statusCode, 200);
});

test('rate limit: sin CF-Connecting-IP se usa la IP de la conexión', async () => {
  const app = await mkApp({ rateResolvePerMin: 1 });
  assert.equal((await app.inject({ method: 'POST', url: '/api/resolve', payload: body })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/resolve', payload: body })).statusCode, 429);
  // una cabecera basura no sirve para saltarse el límite: cae a req.ip
  const junk = await app.inject({
    method: 'POST',
    url: '/api/resolve',
    headers: { 'cf-connecting-ip': 'x'.repeat(500) },
    payload: body,
  });
  assert.equal(junk.statusCode, 429);
});

test('rate limit: el SSE sigue funcionando bajo el límite general', async () => {
  const app = await mkApp({ rateGeneralPerMin: 50 });
  const created = await from(app, '203.0.113.6', '/api/jobs', body);
  const id = created.json().id as string;
  core.claimNextJob();
  core.finishJob(id, 'done');
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const res = await fetch(`${address}/api/jobs/${id}/events`, { headers: { 'cf-connecting-ip': '203.0.113.6' } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^data: .*"status":"done"/);
});

// --- Topes de cola, por IP y disco ----------------------------------------

test('tope por IP: rechaza con 429 al superar MAX_ACTIVE_JOBS_PER_IP y no cuenta a otras IPs', async () => {
  const app = await mkApp({ maxActiveJobsPerIp: 2 });
  assert.equal((await from(app, '203.0.113.10', '/api/jobs', body)).statusCode, 200);
  assert.equal((await from(app, '203.0.113.10', '/api/jobs', body)).statusCode, 200);
  const refused = await from(app, '203.0.113.10', '/api/jobs', body);
  assert.equal(refused.statusCode, 429);
  assert.match(refused.json().error, /descargas en curso/);
  assert.ok(refused.headers['retry-after']);
  assert.equal((await from(app, '203.0.113.11', '/api/jobs', body)).statusCode, 200);

  // al terminar uno, la IP vuelve a poder crear
  const row = core.getDb().prepare(`SELECT id FROM jobs WHERE client_key IS NOT NULL ORDER BY created_at LIMIT 1`).get() as unknown as {
    id: string;
  };
  core.finishJob(row.id, 'done');
  assert.equal((await from(app, '203.0.113.10', '/api/jobs', body)).statusCode, 200);
});

test('tope de cola global: 429 cuando hay MAX_QUEUED_JOBS en cola', async () => {
  const app = await mkApp({ maxQueuedJobs: 2 });
  assert.equal((await from(app, '203.0.113.20', '/api/jobs', body)).statusCode, 200);
  assert.equal((await from(app, '203.0.113.21', '/api/jobs', body)).statusCode, 200);
  const refused = await from(app, '203.0.113.22', '/api/jobs', body);
  assert.equal(refused.statusCode, 429);
  assert.match(refused.json().error, /en cola/);
  // un trabajo en ejecución ya no ocupa la cola
  core.claimNextJob();
  assert.equal((await from(app, '203.0.113.22', '/api/jobs', body)).statusCode, 200);
});

test('tope de disco: 503 con mensaje amable cuando data/jobs ya ocupa el máximo', async () => {
  let used = 5 * 1024 * 1024;
  const app = await mkApp({ maxDiskBytes: 10 * 1024 * 1024 }, { diskUsage: async () => used });
  assert.equal((await from(app, '203.0.113.30', '/api/jobs', body)).statusCode, 200);
  used = 10 * 1024 * 1024;
  const refused = await from(app, '203.0.113.31', '/api/jobs', body);
  assert.equal(refused.statusCode, 503);
  assert.match(refused.json().error, /almacenamiento/);
});

test('el trabajo guarda una huella de la IP (16 hex), nunca la IP', async () => {
  const app = await mkApp();
  const res = await from(app, '198.51.100.77', '/api/jobs', body);
  const row = core.getJobRow(res.json().id)!;
  assert.match(row.client_key ?? '', /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(row).includes('198.51.100.77'));
  assert.equal(row.client_key, core.clientKeyFor('198.51.100.77'));
  assert.notEqual(core.clientKeyFor('198.51.100.78'), row.client_key);
  assert.ok(fs.existsSync(path.join(tmp, 'ip-secret')));
});

// --- Turnstile --------------------------------------------------------------

interface Call {
  url: string;
  params: URLSearchParams;
}
function fakeSiteverify(reply: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), params: new URLSearchParams(String(init?.body)) });
    return reply();
  }) as typeof fetch;
  return { fn, calls };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('GET /api/config expone la clave pública y nunca la secreta', async () => {
  const on = await mkApp({ turnstileSecretKey: 'secret-xyz', turnstileSiteKey: 'site-abc' });
  const res = await on.inject('/api/config');
  assert.deepEqual(res.json(), { mode: 'server', downloadDir: null, turnstileSiteKey: 'site-abc' });
  assert.ok(!res.body.includes('secret-xyz'));
  const off = await mkApp({ turnstileSecretKey: null, turnstileSiteKey: 'site-abc' });
  assert.deepEqual((await off.inject('/api/config')).json(), { mode: 'server', downloadDir: null, turnstileSiteKey: null });
});

test('turnstile: sin clave secreta no se pide token', async () => {
  const app = await mkApp();
  assert.equal((await from(app, '203.0.113.40', '/api/jobs', body)).statusCode, 200);
});

test('turnstile: falta el token -> 400', async () => {
  const { fn, calls } = fakeSiteverify(() => json({ success: true }));
  const app = await mkApp({ turnstileSecretKey: 's', turnstileSiteKey: 'k' }, { turnstileFetch: fn });
  for (const extra of [{}, { turnstileToken: '' }, { turnstileToken: 7 }]) {
    const res = await from(app, '203.0.113.41', '/api/jobs', { ...body, ...extra });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /verificación anti-bots/);
  }
  assert.equal(calls.length, 0);
});

test('turnstile: token válido -> 200 y siteverify recibe secret, response y remoteip (form)', async () => {
  const { fn, calls } = fakeSiteverify(() => json({ success: true }));
  const app = await mkApp({ turnstileSecretKey: '1x0000000000000000000000000000000AA', turnstileSiteKey: 'k' }, { turnstileFetch: fn });
  const res = await from(app, '203.0.113.42', '/api/jobs', { ...body, turnstileToken: 'tok-1' });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[0]!.params.get('secret'), '1x0000000000000000000000000000000AA');
  assert.equal(calls[0]!.params.get('response'), 'tok-1');
  assert.equal(calls[0]!.params.get('remoteip'), '203.0.113.42');
});

test('turnstile: token rechazado -> 403 con el mensaje anti-bots', async () => {
  const { fn } = fakeSiteverify(() => json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
  const app = await mkApp({ turnstileSecretKey: '2x0000000000000000000000000000000AA', turnstileSiteKey: 'k' }, { turnstileFetch: fn });
  const res = await from(app, '203.0.113.43', '/api/jobs', { ...body, turnstileToken: 'tok' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'Verificación anti-bots fallida. Recarga la página e inténtalo de nuevo.');
  assert.equal(core.countQueuedJobs(), 0);
});

test('turnstile: fallo de red, HTTP 5xx, JSON roto o secreto inválido -> falla cerrado con 503', async () => {
  const cases: (() => Response | Promise<Response>)[] = [
    () => {
      throw new TypeError('fetch failed');
    },
    () => new Response('boom', { status: 502 }),
    () => new Response('<html>', { status: 200 }),
    () => json({ success: false, 'error-codes': ['invalid-input-secret'] }),
  ];
  for (const c of cases) {
    const { fn } = fakeSiteverify(c);
    const app = await mkApp({ turnstileSecretKey: 's', turnstileSiteKey: 'k' }, { turnstileFetch: fn });
    const res = await from(app, '203.0.113.44', '/api/jobs', { ...body, turnstileToken: 'tok' });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /verificación anti-bots/);
  }
  assert.equal(core.countQueuedJobs(), 0);
});

test('turnstile: la espera máxima corta peticiones colgadas (503)', async () => {
  const { verifyTurnstile } = await import('./turnstile');
  const hang = ((_u: string, init?: RequestInit) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch;
  assert.equal(await verifyTurnstile({ secret: 's', token: 't', fetch: hang, timeoutMs: 30 }), 'unavailable');
});

test('turnstile: un token de más de 2048 caracteres se rechaza sin llamar a Cloudflare', async () => {
  const { fn, calls } = fakeSiteverify(() => json({ success: true }));
  const app = await mkApp({ turnstileSecretKey: 's', turnstileSiteKey: 'k' }, { turnstileFetch: fn });
  // el bodyLimit (16 KB) permite un token de 3000; debe ser 403 sin consultar siteverify
  const res = await from(app, '203.0.113.45', '/api/jobs', { ...body, turnstileToken: 'a'.repeat(3000) });
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});
