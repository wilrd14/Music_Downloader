import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadOptions, Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-runner-'));
process.env.DATA_DIR = tmp; // antes de importar config
const db = await import('../core/db');
const { UserError } = await import('../core'); // tras fijar DATA_DIR (un import estático cargaría la config antes)
const { runJob, Semaphore, withRetry } = await import('./runner');

before(() => {
  db.getDb();
});
after(() => {
  db.getDb().close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = () => {};

const mk = (n: number): TrackInfo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Titulo ${i}`,
    artist: 'Artista',
    durationSec: 100,
    thumbnail: null,
    url: `https://www.youtube.com/watch?v=t${i}`,
  }));

let seq = 0;
function newJob(n: number, kind: 'track' | 'playlist' = 'playlist') {
  const id = `runner-job${++seq}`;
  db.createJob({ id, provider: 'fake', sourceUrl: 'https://x', title: id, kind, format: 'mp3', thumbnail: null, tracks: mk(n) });
  return db.getJobRow(id)!;
}

/** Resolver falso que mide cuántas descargas hay en vuelo y cuántos intentos recibe cada pista. */
function fakeResolver(opts: { ms?: number; fail?: (trackId: string, attempt: number) => Error | null } = {}) {
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    calls: [] as { id: string; fileBase: string }[],
    attempts: new Map<string, number>(),
  };
  const resolver: Resolver = {
    name: 'fake',
    canHandle: () => true,
    resolve: async () => {
      throw new Error('no usado');
    },
    async download(track: TrackInfo, o: DownloadOptions) {
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      const attempt = (state.attempts.get(track.id) ?? 0) + 1;
      state.attempts.set(track.id, attempt);
      state.calls.push({ id: track.id, fileBase: o.fileBase });
      try {
        o.onProgress(10, 'downloading');
        await sleep(opts.ms ?? 20);
        const err = opts.fail?.(track.id, attempt);
        if (err) throw err;
        o.onProgress(95, 'converting');
        return path.join(o.outDir, `${o.fileBase}.${o.format}`);
      } finally {
        state.inFlight--;
      }
    },
  };
  return { resolver, state };
}

const deps = (resolver: Resolver, semaphore: InstanceType<typeof Semaphore>, extra = {}) => ({
  resolver,
  semaphore,
  retryDelayMs: 1,
  progressThrottleMs: 0,
  log: quiet,
  ...extra,
});

test('Semaphore: nunca supera el límite y libera en orden FIFO', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let max = 0;
  const order: number[] = [];
  await Promise.all(
    [0, 1, 2, 3, 4].map((i) =>
      sem.run(async () => {
        order.push(i);
        active++;
        max = Math.max(max, active);
        await sleep(10);
        active--;
      }),
    ),
  );
  assert.equal(max, 2);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.equal(sem.inUse, 0);
  assert.throws(() => new Semaphore(0), RangeError);
});

test('Semaphore: liberar dos veces el mismo hueco no corrompe la cuenta', async () => {
  const sem = new Semaphore(1);
  const release = await sem.acquire();
  release();
  release();
  assert.equal(sem.inUse, 0);
});

test('withRetry: reintenta una vez y luego propaga el error', async () => {
  let n = 0;
  await assert.rejects(
    withRetry(
      async () => {
        n++;
        throw new Error('x');
      },
      1,
      1,
    ),
  );
  assert.equal(n, 2);
});

test('un trabajo respeta TRACK_CONCURRENCY y usa el paralelismo disponible', async () => {
  const job = newJob(8);
  const { resolver, state } = fakeResolver({ ms: 30 });
  const t0 = Date.now();
  const res = await runJob(job, deps(resolver, new Semaphore(10), { trackConcurrency: 3, outDir: tmp }));
  assert.deepEqual(res, { ok: 8, total: 8 });
  assert.equal(state.maxInFlight, 3);
  assert.ok(Date.now() - t0 < 8 * 30, 'debe tardar menos que en secuencial');
  assert.equal(db.getJobRow(job.id)!.status, 'done');
});

test('trackConcurrency = 1 equivale a procesar en secuencia', async () => {
  const job = newJob(4);
  const { resolver, state } = fakeResolver();
  await runJob(job, deps(resolver, new Semaphore(10), { trackConcurrency: 1, outDir: tmp }));
  assert.equal(state.maxInFlight, 1);
});

test('el semáforo global limita las descargas sumando varios trabajos', async () => {
  const jobs = [newJob(6), newJob(6), newJob(6)];
  const { resolver, state } = fakeResolver({ ms: 25 });
  const sem = new Semaphore(4);
  const results = await Promise.all(jobs.map((j) => runJob(j, deps(resolver, sem, { trackConcurrency: 3, outDir: tmp }))));
  assert.ok(results.every((r) => r.ok === 6));
  assert.equal(state.maxInFlight, 4);
  assert.equal(sem.inUse, 0);
});

test('una pista que espera hueco global no figura como "downloading"', async () => {
  const job = newJob(3);
  const { resolver } = fakeResolver({ ms: 60 });
  const p = runJob(job, deps(resolver, new Semaphore(1), { trackConcurrency: 3, outDir: tmp }));
  await sleep(20);
  const statuses = db.getTrackRows(job.id).map((t) => t.status);
  assert.equal(statuses.filter((s) => s === 'downloading' || s === 'converting').length, 1);
  assert.equal(statuses.filter((s) => s === 'queued').length, 2);
  await p;
});

test('reintenta una vez por pista: un fallo suelto acaba bien', async () => {
  const job = newJob(3);
  const { resolver, state } = fakeResolver({ fail: (id, attempt) => (id === 't1' && attempt === 1 ? new Error('red') : null) });
  const res = await runJob(job, deps(resolver, new Semaphore(4), { outDir: tmp }));
  assert.equal(res.ok, 3);
  assert.equal(state.attempts.get('t1'), 2);
  assert.equal(state.attempts.get('t0'), 1);
});

test('aislamiento de errores: una pista que siempre falla no detiene a las demás', async () => {
  const job = newJob(5);
  const { resolver, state } = fakeResolver({
    fail: (id) => (id === 't2' ? new UserError('El video no está disponible.') : id === 't3' ? new Error('boom') : null),
  });
  const origError = console.error;
  console.error = quiet;
  let res;
  try {
    res = await runJob(job, deps(resolver, new Semaphore(4), { outDir: tmp }));
  } finally {
    console.error = origError;
  }
  assert.deepEqual(res, { ok: 3, total: 5 });
  assert.equal(state.attempts.get('t2'), 2, 'se reintentó una vez');
  const rows = db.getTrackRows(job.id);
  assert.deepEqual(
    rows.map((r) => r.status),
    ['done', 'done', 'failed', 'failed', 'done'],
  );
  assert.equal(rows[2]!.error, 'El video no está disponible.');
  assert.equal(rows[3]!.error, 'Error inesperado al descargar esta pista.');
  assert.equal(db.getJobRow(job.id)!.status, 'done');
});

test('estado final: failed si ninguna pista salió bien', async () => {
  const job = newJob(2);
  const { resolver } = fakeResolver({ fail: () => new UserError('nope') });
  const res = await runJob(job, deps(resolver, new Semaphore(2), { outDir: tmp }));
  assert.equal(res.ok, 0);
  const row = db.getJobRow(job.id)!;
  assert.equal(row.status, 'failed');
  assert.equal(row.error, 'No se pudo descargar ninguna pista.');
});

test('numeración: playlist con prefijo con relleno según el total; pista suelta sin prefijo', async () => {
  const job = newJob(12);
  const { resolver, state } = fakeResolver();
  await runJob(job, deps(resolver, new Semaphore(4), { trackConcurrency: 3, outDir: tmp }));
  const byId = new Map(state.calls.map((c) => [c.id, c.fileBase]));
  assert.equal(byId.get('t0'), '01 - Artista - Titulo 0');
  assert.equal(byId.get('t9'), '10 - Artista - Titulo 9');
  assert.equal(byId.get('t11'), '12 - Artista - Titulo 11');

  const single = newJob(1, 'track');
  const f = fakeResolver();
  await runJob(single, deps(f.resolver, new Semaphore(1), { outDir: tmp }));
  assert.equal(f.state.calls[0]!.fileBase, 'Artista - Titulo 0');
  assert.equal(db.getTrackRows(single.id)[0]!.file_path, path.join(tmp, 'Artista - Titulo 0.mp3'));
});

test('recuperación: las pistas ya hechas no se repiten y cuentan para el estado final', async () => {
  const job = newJob(4);
  db.updateTrack(job.id, 0, { status: 'done', progress: 100, file_path: 'x.mp3' });
  db.updateTrack(job.id, 1, { status: 'downloading', progress: 40 });
  // el job quedó en 'running' por un cierre inesperado del worker: se reencola
  db.getDb().prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id);
  assert.ok(db.recoverInterruptedJobs() >= 1);
  assert.equal(db.getTrackRows(job.id)[1]!.status, 'queued');

  const { resolver, state } = fakeResolver({ fail: () => new UserError('x') });
  const res = await runJob(db.getJobRow(job.id)!, deps(resolver, new Semaphore(4), { outDir: tmp }));
  assert.equal(state.attempts.has('t0'), false);
  assert.equal(res.ok, 1); // solo la que ya estaba hecha
  assert.equal(db.getJobRow(job.id)!.status, 'done');
});

test('progreso agregado coherente con escrituras concurrentes y 100 % al terminar', async () => {
  const job = newJob(6);
  const { resolver } = fakeResolver({ ms: 40 });
  const seen: number[] = [];
  const p = runJob(job, deps(resolver, new Semaphore(4), { trackConcurrency: 3, outDir: tmp }));
  const poll = setInterval(() => seen.push(db.getJobState(job.id)!.progress), 5);
  await p;
  clearInterval(poll);
  assert.ok(seen.every((v) => v >= 0 && v <= 99), 'mientras corre nunca llega a 100');
  assert.ok(seen.some((v) => v > 0), 'se observa progreso intermedio');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i]! >= seen[i - 1]!, 'el progreso no retrocede');
  const final = db.getJobState(job.id)!;
  assert.equal(final.progress, 100);
  assert.ok(final.tracks.every((t) => t.status === 'done' && t.progress === 100));
});
