import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { listenOnFreePort } from './port';

const inUse = () => Object.assign(new Error('in use'), { code: 'EADDRINUSE' });

test('usa el puerto inicial si está libre', async () => {
  const tried: number[] = [];
  const port = await listenOnFreePort(async (p) => void tried.push(p), 8787);
  assert.equal(port, 8787);
  assert.deepEqual(tried, [8787]);
});

test('salta puertos ocupados y se queda con el primero libre', async () => {
  const busy = new Set([8787, 8788, 8789]);
  const tried: number[] = [];
  const port = await listenOnFreePort(async (p) => {
    tried.push(p);
    if (busy.has(p)) throw inUse();
  }, 8787);
  assert.equal(port, 8790);
  assert.deepEqual(tried, [8787, 8788, 8789, 8790]);
});

test('prueba como máximo 10 puertos seguidos', async () => {
  const tried: number[] = [];
  await assert.rejects(
    listenOnFreePort(async (p) => {
      tried.push(p);
      throw inUse();
    }, 9000),
    /9000 y 9009/,
  );
  assert.equal(tried.length, 10);
});

test('otros errores no se tragan', async () => {
  await assert.rejects(
    listenOnFreePort(async () => {
      throw Object.assign(new Error('boom'), { code: 'EINVAL' });
    }, 8787),
    /boom/,
  );
});

test('con sockets reales: salta un puerto ocupado en 127.0.0.1', async () => {
  const blocker = net.createServer();
  await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
  const taken = (blocker.address() as net.AddressInfo).port;
  const probes: net.Server[] = [];
  try {
    const port = await listenOnFreePort(
      (p) =>
        new Promise<void>((resolve, reject) => {
          const s = net.createServer();
          s.once('error', reject);
          s.listen(p, '127.0.0.1', () => {
            probes.push(s);
            resolve();
          });
        }),
      taken,
    );
    assert.ok(port > taken && port < taken + 10);
  } finally {
    probes.forEach((s) => s.close());
    blocker.close();
  }
});
