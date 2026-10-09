import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-static-'));
process.env.DATA_DIR = tmp; // antes de importar config
process.env.TUNEDROP_MODE = 'server'; // estas pruebas cubren el modo servidor
const { buildApp } = await import('./app');

const dist = path.join(tmp, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>tunedrop</title>');
fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, '_headers'), '/*\n  X-Test: 1');

let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  app = await buildApp({ staticDir: dist, resolvers: [], checkTools: async () => ({ ok: true, ytDlp: 'x', ffmpeg: true }) });
});
after(async () => {
  await app.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

test('sirve la interfaz en / con CSP de frontend y sin caché', async () => {
  const res = await app.inject('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<title>tunedrop<\/title>/);
  const csp = String(res.headers['content-security-policy']);
  assert.match(csp, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(csp, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self';/);
  // Debe coincidir con la política de frontend/public/_headers (Cloudflare Pages).
  const headersFile = fs.readFileSync(path.resolve(import.meta.dirname, '../../../frontend/public/_headers'), 'utf8');
  assert.ok(headersFile.includes(`Content-Security-Policy: ${csp}`));
  assert.match(String(res.headers['content-security-policy']), /img-src [^;]*i\.ytimg\.com/);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['cache-control'], 'no-cache');
});

test('los assets con hash se cachean de forma inmutable', async () => {
  const res = await app.inject('/assets/app-abc123.js');
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['cache-control']), /immutable/);
});

test('rutas desconocidas que no son /api devuelven la app (SPA)', async () => {
  const res = await app.inject('/alguna/ruta');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /tunedrop/);
});

test('rutas /api desconocidas siguen siendo 404 JSON con CSP de API', async () => {
  const res = await app.inject('/api/nada');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'No encontrado.');
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
});

test('el archivo _headers de Pages no se expone', async () => {
  const res = await app.inject('/_headers');
  assert.notEqual(res.body, '/*\n  X-Test: 1');
});

test('la API sigue funcionando junto a la interfaz', async () => {
  const res = await app.inject('/api/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);
});

test('sin carpeta de interfaz solo se sirve la API', async () => {
  const api = await buildApp({ staticDir: path.join(tmp, 'no-existe'), resolvers: [] });
  assert.equal((await api.inject('/')).statusCode, 404);
  await api.close();
});
