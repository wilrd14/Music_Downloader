import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { TrackInfo } from './types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-db-'));
process.env.DATA_DIR = tmp; // antes de importar config
const db = await import('./db');

const mk = (n: number): TrackInfo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    title: `Titulo ${i}`,
    artist: 'Artista',
    durationSec: 100,
    thumbnail: null,
    url: `https://www.youtube.com/watch?v=t${i}`,
  }));

const newJob = (id: string, n = 2, kind: 'track' | 'playlist' = 'playlist') =>
  db.createJob({
    id,
    provider: 'youtube',
    sourceUrl: 'https://x',
    title: id,
    kind,
    format: 'mp3',
    thumbnail: null,
    tracks: mk(n),
  });

before(() => {
  db.getDb();
});

after(() => {
  db.getDb().close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('la base de datos vive en DATA_DIR', () => {
  assert.ok(fs.existsSync(path.join(tmp, 'tunedrop.db')));
});

test('createJob inserta trabajo y pistas en cola', () => {
  newJob('j-create', 3);
  const state = db.getJobState('j-create');
  assert.ok(state);
  assert.equal(state.status, 'queued');
  assert.equal(state.tracks.length, 3);
  assert.equal(state.progress, 0);
  assert.equal(state.downloadReady, false);
  assert.equal(db.getJobState('nope'), null);
});

test('createJob hace rollback si falla', () => {
  assert.throws(() => newJob('j-create', 1)); // id duplicado
  const bad = { ...mk(1)[0], title: null } as unknown as TrackInfo; // viola NOT NULL tras insertar el trabajo
  assert.throws(() =>
    db.createJob({
      id: 'j-rollback',
      provider: 'youtube',
      sourceUrl: 'x',
      title: 'x',
      kind: 'track',
      format: 'mp3',
      thumbnail: null,
      tracks: [bad],
    }),
  );
  assert.equal(db.getJobRow('j-rollback'), null);
});

test('claimNextJob toma en orden de creación, una sola vez, aun con el mismo timestamp', () => {
  // drenar lo anterior
  while (db.claimNextJob()) {
    /* vaciar */
  }
  const realNow = Date.now;
  Date.now = () => 1_000_000; // mismo milisegundo para los tres
  try {
    newJob('o-1');
    newJob('o-2');
    newJob('o-3');
  } finally {
    Date.now = realNow;
  }
  assert.equal(db.getJobState('o-1')?.queuePosition, 1);
  assert.equal(db.getJobState('o-2')?.queuePosition, 2);
  assert.equal(db.getJobState('o-3')?.queuePosition, 3);

  const a = db.claimNextJob();
  const b = db.claimNextJob();
  const c = db.claimNextJob();
  assert.deepEqual([a?.id, b?.id, c?.id], ['o-1', 'o-2', 'o-3']);
  assert.equal(a?.status, 'running');
  assert.ok(a?.started_at);
  assert.equal(db.claimNextJob(), null);
  assert.equal(db.getJobState('o-1')?.queuePosition, null);
});

test('updateTrack y progreso agregado', () => {
  newJob('j-prog', 2);
  db.claimNextJob();
  db.updateTrack('j-prog', 0, { status: 'done', progress: 100, file_path: '/a.mp3' });
  db.updateTrack('j-prog', 1, { status: 'downloading', progress: 50 });
  let s = db.getJobState('j-prog');
  assert.equal(s?.progress, 75);
  assert.equal(s?.tracks[0]?.status, 'done');
  assert.equal(s?.tracks[1]?.progress, 50);

  db.updateTrack('j-prog', 1, { status: 'failed', error: 'boom', progress: 0 });
  s = db.getJobState('j-prog');
  assert.equal(s?.progress, 99); // nunca 100 hasta que el trabajo termina
  assert.equal(s?.tracks[1]?.error, 'boom');

  db.updateTrack('j-prog', 0, {}); // sin cambios: no falla
  db.finishJob('j-prog', 'done');
  s = db.getJobState('j-prog');
  assert.equal(s?.progress, 100);
  assert.equal(s?.status, 'done');
  assert.equal(s?.downloadReady, true);
});

test('finishJob failed guarda el error y no habilita descarga', () => {
  newJob('j-fail', 1);
  db.claimNextJob();
  db.updateTrack('j-fail', 0, { status: 'failed', error: 'x' });
  db.finishJob('j-fail', 'failed', 'No se pudo');
  const s = db.getJobState('j-fail');
  assert.equal(s?.status, 'failed');
  assert.equal(s?.error, 'No se pudo');
  assert.equal(s?.downloadReady, false);
});

test('recoverInterruptedJobs reencola trabajos running y reinicia pistas en curso', () => {
  // limpiar restos de pruebas anteriores
  for (let j = db.claimNextJob(); j; j = db.claimNextJob()) db.finishJob(j.id, 'done');
  db.recoverInterruptedJobs();
  for (let j = db.claimNextJob(); j; j = db.claimNextJob()) db.finishJob(j.id, 'done');
  newJob('j-rec', 3);
  db.claimNextJob();
  db.updateTrack('j-rec', 0, { status: 'done', progress: 100 });
  db.updateTrack('j-rec', 1, { status: 'converting', progress: 92 });
  assert.equal(db.recoverInterruptedJobs(), 1);
  const s = db.getJobState('j-rec');
  assert.equal(s?.status, 'queued');
  assert.deepEqual(s?.tracks.map((t) => [t.status, t.progress]), [
    ['done', 100],
    ['queued', 0],
    ['queued', 0],
  ]);
  assert.equal(db.recoverInterruptedJobs(), 0);
});

test('findExpiredJobIds / markExpired', () => {
  const realNow = Date.now;
  Date.now = () => realNow() - 60 * 60_000;
  try {
    newJob('e-old', 1);
    db.finishJob('e-old', 'done');
    newJob('e-failed', 1);
    db.finishJob('e-failed', 'failed', 'x');
  } finally {
    Date.now = realNow;
  }
  newJob('e-new', 1);
  db.finishJob('e-new', 'done');
  newJob('e-queued', 1);

  const ids = db.findExpiredJobIds(30 * 60_000);
  assert.ok(ids.includes('e-old') && ids.includes('e-failed'));
  assert.ok(!ids.includes('e-new') && !ids.includes('e-queued'));

  db.updateTrack('e-old', 0, { status: 'done', file_path: '/tmp/x.mp3' });
  db.markExpired('e-old');
  const s = db.getJobState('e-old');
  assert.equal(s?.status, 'expired');
  assert.equal(s?.downloadReady, false);
  assert.equal(db.getTrackRows('e-old')[0]?.file_path, null);
  assert.ok(!db.findExpiredJobIds(30 * 60_000).includes('e-old'));
});
