import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-lim-'));
process.env.DATA_DIR = tmp;
const { clientKeyFor } = await import('./clientKey');
const { createDiskUsage, dirSize } = await import('./disk');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('clientKeyFor: 16 hex estables, distintos por IP, secreto persistido y no registrado', () => {
  const a = clientKeyFor('203.0.113.1');
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(clientKeyFor('203.0.113.1'), a);
  assert.notEqual(clientKeyFor('203.0.113.2'), a);
  const secretFile = path.join(tmp, 'ip-secret');
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  assert.match(secret, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('203'));
});

test('clientKeyFor: reutiliza el secreto de otra carpeta y regenera si está corrupto', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'k-'));
  const first = clientKeyFor('1.1.1.1', dir);
  assert.equal(clientKeyFor('1.1.1.1', dir), first);
  const dir2 = fs.mkdtempSync(path.join(tmp, 'k-'));
  fs.writeFileSync(path.join(dir2, 'ip-secret'), 'basura');
  assert.match(clientKeyFor('1.1.1.1', dir2), /^[0-9a-f]{16}$/);
  assert.match(fs.readFileSync(path.join(dir2, 'ip-secret'), 'utf8').trim(), /^[0-9a-f]{64}$/);
  assert.notEqual(clientKeyFor('1.1.1.1', dir2), first);
});

test('dirSize suma recursivamente y una carpeta inexistente es 0', async () => {
  const d = fs.mkdtempSync(path.join(tmp, 'd-'));
  fs.mkdirSync(path.join(d, 'sub'));
  fs.writeFileSync(path.join(d, 'a.bin'), Buffer.alloc(100));
  fs.writeFileSync(path.join(d, 'sub', 'b.bin'), Buffer.alloc(50));
  assert.equal(await dirSize(d), 150);
  assert.equal(await dirSize(path.join(d, 'no-existe')), 0);
});

test('createDiskUsage cachea durante el TTL (reloj inyectable) y evita medidas simultáneas', async () => {
  let t = 1000;
  let calls = 0;
  const usage = createDiskUsage('x', {
    ttlMs: 10_000,
    now: () => t,
    measure: async () => {
      calls++;
      return calls * 100;
    },
  });
  const [a, b] = await Promise.all([usage(), usage()]);
  assert.equal(a, 100);
  assert.equal(b, 100);
  assert.equal(calls, 1);
  t += 9_999;
  assert.equal(await usage(), 100);
  t += 2;
  assert.equal(await usage(), 200);
  assert.equal(calls, 2);
});
