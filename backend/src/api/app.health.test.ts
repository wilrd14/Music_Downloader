import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { HealthState } from '../core';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-health-'));
process.env.DATA_DIR = tmp; // antes de importar config
process.env.TUNEDROP_MODE = 'server';
const { buildApp } = await import('./app');

after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // en Windows SQLite mantiene abierta la base hasta salir del proceso
  }
});

const MALO: HealthState = { ok: false, ytDlp: null, ffmpeg: false };
const BUENO: HealthState = { ok: true, ytDlp: '2026.08.19', ffmpeg: true };

test('/api/health: un resultado malo se cachea solo 2 s y uno bueno 30 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const respuestas = [MALO, BUENO];
  let llamadas = 0;
  const app = await buildApp({
    resolvers: [],
    checkTools: async () => respuestas[Math.min(llamadas++, respuestas.length - 1)] as HealthState,
  });
  const salud = async () => (await app.inject('/api/health')).json() as HealthState;

  assert.equal((await salud()).ok, false, 'primera comprobación: mala');
  assert.equal((await salud()).ok, false, 'dentro de 2 s se reutiliza el resultado malo');
  assert.equal(llamadas, 1);

  t.mock.timers.tick(2_500);
  assert.equal((await salud()).ok, true, 'pasados 2 s se vuelve a comprobar y ya está bien');
  assert.equal(llamadas, 2);

  t.mock.timers.tick(20_000);
  assert.equal((await salud()).ok, true);
  assert.equal(llamadas, 2, 'un resultado bueno se reutiliza durante 30 s');

  t.mock.timers.tick(11_000);
  await salud();
  assert.equal(llamadas, 3, 'pasados 30 s se comprueba otra vez');

  await app.close();
});
