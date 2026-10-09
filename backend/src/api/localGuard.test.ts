import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedHosts, checkLocalRequest, type GuardInput } from './localGuard';

const base: GuardInput = { host: '127.0.0.1:8787', origin: undefined, secFetchSite: undefined, port: 8787, isApi: true };
const check = (over: Partial<GuardInput>) => checkLocalRequest({ ...base, ...over });
const reason = (over: Partial<GuardInput>) => {
  const d = check(over);
  return d.ok ? 'ok' : d.reason;
};

test('Host: solo localhost, 127.0.0.1 y [::1] con el puerto real', () => {
  assert.deepEqual(allowedHosts(8788), ['localhost:8788', '127.0.0.1:8788', '[::1]:8788']);
  for (const host of ['127.0.0.1:8787', 'localhost:8787', 'LOCALHOST:8787', '[::1]:8787']) assert.equal(reason({ host }), 'ok', host);
  for (const host of [
    undefined,
    '',
    'evil.example:8787', // DNS rebinding
    'evil.example',
    '127.0.0.1', // sin puerto
    '127.0.0.1:8788', // otro puerto
    'localhost:80',
    '127.0.0.1.evil.example:8787',
    'localhost.evil.example:8787',
    '0.0.0.0:8787',
    '192.168.1.5:8787',
    '127.0.0.1:8787@evil.example',
  ]) {
    assert.equal(reason({ host }), 'host', String(host));
  }
});

test('Host se exige también fuera de /api (la interfaz)', () => {
  assert.equal(reason({ host: 'evil.example:8787', isApi: false }), 'host');
  assert.equal(reason({ isApi: false, origin: 'https://evil.example', secFetchSite: 'cross-site' }), 'ok');
});

test('Origin: sin cabecera pasa; con cabecera debe ser el origen propio', () => {
  assert.equal(reason({ origin: undefined }), 'ok');
  assert.equal(reason({ origin: 'http://127.0.0.1:8787' }), 'ok');
  assert.equal(reason({ host: 'localhost:8787', origin: 'http://localhost:8787' }), 'ok');
  for (const origin of [
    'https://evil.example',
    'http://evil.example:8787',
    'null',
    '',
    'http://localhost:8787', // otro origen aunque también sea local (Host es 127.0.0.1)
    'https://127.0.0.1:8787',
    'http://127.0.0.1:8788',
    'http://127.0.0.1:8787.evil.example',
  ]) {
    assert.equal(reason({ origin }), 'origin', origin);
  }
});

test('Sec-Fetch-Site: solo same-origin o none', () => {
  assert.equal(reason({ secFetchSite: 'same-origin' }), 'ok');
  assert.equal(reason({ secFetchSite: 'none' }), 'ok');
  assert.equal(reason({ secFetchSite: 'same-site' }), 'sec-fetch-site');
  assert.equal(reason({ secFetchSite: 'cross-site' }), 'sec-fetch-site');
  assert.equal(reason({ secFetchSite: '' }), 'sec-fetch-site');
});
