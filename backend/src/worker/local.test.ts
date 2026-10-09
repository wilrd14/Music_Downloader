import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { DownloadOptions, Resolver, TrackInfo } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-wlocal-'));
process.env.DATA_DIR = path.join(tmp, 'data'); // antes de importar config
process.env.TUNEDROP_MODE = 'local';
const db = await import('../core/db');
const { config, jobOutDir } = await import('../core');
const { runJob, Semaphore } = await import('./runner');
const { cleanup } = await import('./start');

before(() => {
  db.getDb();
});
after(() => {
  db.getDb().close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

const quiet = () => {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mk = (titles: string[]): TrackInfo[] =>
  titles.map((title, i) => ({ id: `t${i}`, title, artist: 'Artista', durationSec: 100, thumbnail: null, url: `https://www.youtube.com/watch?v=t${i}` }));

let seq = 0;
function newJob(tracks: TrackInfo[], kind: 'track' | 'playlist', title = 'Titulo') {
  const id = `local-job${++seq}`;
  db.createJob({ id, provider: 'fake', sourceUrl: 'https://x', title, kind, format: 'mp3', thumbnail: null, tracks });
  return db.getJobRow(id)!;
}

/** Resolver falso que escribe de verdad un archivo en outDir (como haría yt-dlp). */
const writer: Resolver = {
  name: 'fake',
  canHandle: () => true,
  resolve: async () => {
    throw new Error('no usado');
  },
  async download(track: TrackInfo, o: DownloadOptions) {
    await sleep(10);
    fs.mkdirSync(o.outDir, { recursive: true });
    const file = path.join(o.outDir, `${o.fileBase}.${o.format}`);
    fs.writeFileSync(file, `audio de ${track.id}`);
    return file;
  },
};

const deps = (outDir: Parameters<typeof runJob>[1]['outDir'], extra = {}) => ({
  resolver: writer,
  semaphore: new Semaphore(4),
  retryDelayMs: 1,
  progressThrottleMs: 0,
  log: quiet,
  outDir,
  uniqueNames: true,
  setSavedTo: db.setJobSavedTo,
  ...extra,
});

test('pista suelta: se guarda directamente en la carpeta de música y se registra savedTo', async () => {
  const music = path.join(tmp, 'm1');
  const job = newJob(mk(['Tema']), 'track');
  const res = await runJob(job, deps((j) => jobOutDir(music, j)));
  assert.deepEqual(res, { ok: 1, total: 1 });
  assert.deepEqual(fs.readdirSync(music), ['Artista - Tema.mp3']);
  const state = db.getJobState(job.id)!;
  assert.equal(state.status, 'done');
  assert.equal(state.savedTo, music);
});

test('playlist: subcarpeta con el título saneado y pistas numeradas', async () => {
  const music = path.join(tmp, 'm2');
  const job = newJob(mk(['Uno', 'Dos']), 'playlist', 'Mi Lista: "rara"/ñ');
  await runJob(job, deps((j) => jobOutDir(music, j)));
  const sub = path.join(music, 'Mi Lista_ _rara__ñ');
  assert.deepEqual(fs.readdirSync(music), ['Mi Lista_ _rara__ñ']);
  assert.deepEqual(fs.readdirSync(sub).sort(), ['1 - Artista - Uno.mp3', '2 - Artista - Dos.mp3']);
  assert.equal(db.getJobState(job.id)!.savedTo, sub);
});

test('nunca sobrescribe: si el archivo existe se añade " (1)", " (2)"...', async () => {
  const music = path.join(tmp, 'm3');
  fs.mkdirSync(music, { recursive: true });
  fs.writeFileSync(path.join(music, 'Artista - Tema.mp3'), 'original de la persona');
  for (let i = 0; i < 2; i++) await runJob(newJob(mk(['Tema']), 'track'), deps((j) => jobOutDir(music, j)));
  assert.deepEqual(fs.readdirSync(music).sort(), ['Artista - Tema (1).mp3', 'Artista - Tema (2).mp3', 'Artista - Tema.mp3']);
  assert.equal(fs.readFileSync(path.join(music, 'Artista - Tema.mp3'), 'utf8'), 'original de la persona');
});

test('dos trabajos simultáneos con la misma canción no se pisan', async () => {
  const music = path.join(tmp, 'm4');
  const out = (j: Parameters<typeof jobOutDir>[1]) => jobOutDir(music, j);
  await Promise.all([1, 2, 3].map(() => runJob(newJob(mk(['Igual']), 'track'), deps(out))));
  assert.deepEqual(fs.readdirSync(music).sort(), ['Artista - Igual (1).mp3', 'Artista - Igual (2).mp3', 'Artista - Igual.mp3']);
});

test('si la carpeta de destino no es válida el trabajo falla sin descargar nada', async () => {
  let downloads = 0;
  const counting: Resolver = { ...writer, download: async (...a) => (downloads++, writer.download(...a)) };
  const job = newJob(mk(['A', 'B']), 'playlist');
  const res = await runJob(
    job,
    deps(() => {
      throw new Error('fuera de la carpeta');
    }, { resolver: counting }),
  );
  assert.equal(res.ok, 0);
  assert.equal(downloads, 0);
  assert.equal(db.getJobState(job.id)!.status, 'failed');
});

test('modo servidor (sin outDir): sigue usando data/jobs/<id>/tracks y savedTo queda en null', async () => {
  const job = newJob(mk(['Tema']), 'track');
  await runJob(job, { resolver: writer, semaphore: new Semaphore(2), retryDelayMs: 1, log: quiet });
  assert.ok(fs.existsSync(path.join(config.jobsDir, job.id, 'tracks', 'Artista - Tema.mp3')));
  assert.equal(db.getJobState(job.id)!.savedTo, null);
});

function finishedJob(ageMs: number, files: string) {
  const job = newJob(mk(['X']), 'track');
  db.finishJob(job.id, 'done');
  db.getDb().prepare('UPDATE jobs SET finished_at = ? WHERE id = ?').run(Date.now() - ageMs, job.id);
  fs.mkdirSync(files, { recursive: true });
  fs.writeFileSync(path.join(files, 'cancion.mp3'), 'x');
  return job.id;
}

test('limpieza en modo local: purga filas antiguas pero NUNCA borra archivos de la persona', () => {
  const music = path.join(tmp, 'm5');
  const old = finishedJob(48 * 3_600_000, music); // más de 24 h: fila fuera
  const recent = finishedJob(2 * 3_600_000, music); // pasó el TTL de 30 min pero no las 24 h: se queda tal cual
  cleanup('local');
  assert.equal(db.getJobRow(old), null);
  assert.equal(db.getJobRow(recent)?.status, 'done');
  assert.ok(fs.existsSync(path.join(music, 'cancion.mp3')));
});

test('limpieza en modo servidor: sigue borrando la carpeta temporal del trabajo y lo marca expirado', () => {
  const id = finishedJob(2 * 3_600_000, path.join(config.jobsDir, 'will-expire', 'tracks'));
  // el nombre de la carpeta debe ser el id del trabajo
  fs.renameSync(path.join(config.jobsDir, 'will-expire'), path.join(config.jobsDir, id));
  cleanup('server');
  assert.equal(fs.existsSync(path.join(config.jobsDir, id)), false);
  assert.equal(db.getJobRow(id)?.status, 'expired');
});
