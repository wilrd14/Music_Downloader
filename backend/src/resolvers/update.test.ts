import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { RunResult } from './proc';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-upd-'));
process.env.DATA_DIR = tmp; // antes de importar config
const { maybeUpdateYtDlp } = await import('./update');
const { readSettings, updateSettings } = await import('../core');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const binDir = path.join(tmp, 'bin');
const bundled = path.join(binDir, 'yt-dlp');
const quiet = () => {};
const ok: RunResult = { code: 0, stdout: 'Updated yt-dlp to 2099.01.01\n', stderr: '' };

function setup() {
  const dataDir = fs.mkdtempSync(path.join(tmp, 'd-'));
  const calls: { cmd: string; args: string[] }[] = [];
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return ok;
  };
  return { dataDir, calls, run };
}

test('no hace nada si está desactivado', async () => {
  const { dataDir, calls, run } = setup();
  assert.equal(await maybeUpdateYtDlp({ enabled: false, ytDlpPath: bundled, binDir, dataDir, run, log: quiet }), 'disabled');
  assert.equal(calls.length, 0);
});

test('nunca toca un yt-dlp que no está en la carpeta bin empaquetada', async () => {
  const { dataDir, calls, run } = setup();
  for (const ytDlpPath of ['yt-dlp', '/usr/local/bin/yt-dlp', path.join(tmp, 'otra', 'yt-dlp'), path.join(binDir, '..', 'yt-dlp')]) {
    assert.equal(await maybeUpdateYtDlp({ enabled: true, ytDlpPath, binDir, dataDir, run, log: quiet }), 'not-bundled', ytDlpPath);
  }
  assert.equal(calls.length, 0);
  assert.equal(readSettings(dataDir).ytDlpLastCheck, undefined);
});

test('actualiza el empaquetado (yt-dlp -U) y guarda la hora; no repite antes de 24 h', async () => {
  const { dataDir, calls, run } = setup();
  let now = 1_000_000_000;
  const opts = { enabled: true, ytDlpPath: bundled, binDir, dataDir, run, now: () => now, log: quiet };

  assert.equal(await maybeUpdateYtDlp(opts), 'updated');
  assert.deepEqual(calls, [{ cmd: bundled, args: ['-U'] }]);
  assert.equal(readSettings(dataDir).ytDlpLastCheck, now);

  now += 23 * 3_600_000;
  assert.equal(await maybeUpdateYtDlp(opts), 'recent');
  assert.equal(calls.length, 1);

  now += 2 * 3_600_000; // ya pasaron 25 h
  assert.equal(await maybeUpdateYtDlp(opts), 'updated');
  assert.equal(calls.length, 2);
});

test('los fallos se registran y nunca lanzan; la comprobación cuenta igualmente', async () => {
  const { dataDir } = setup();
  const logs: unknown[][] = [];
  const boom = async () => {
    throw new Error('sin red');
  };
  const res = await maybeUpdateYtDlp({
    enabled: true,
    ytDlpPath: bundled,
    binDir,
    dataDir,
    run: boom,
    now: () => 5_000,
    log: (...a) => void logs.push(a),
  });
  assert.equal(res, 'failed');
  assert.match(String(logs[0]?.[1]), /sin red/);
  assert.equal(readSettings(dataDir).ytDlpLastCheck, 5_000);

  const d2 = setup();
  const failing = async (): Promise<RunResult> => ({ code: 1, stdout: '', stderr: 'error' });
  assert.equal(await maybeUpdateYtDlp({ enabled: true, ytDlpPath: bundled, binDir, dataDir: d2.dataDir, run: failing, log: quiet }), 'failed');
});

test('conserva el resto de ajustes al guardar la hora', async () => {
  const { dataDir, run } = setup();
  updateSettings(dataDir, { downloadDir: '/x/y' });
  await maybeUpdateYtDlp({ enabled: true, ytDlpPath: bundled, binDir, dataDir, run, now: () => 42, log: quiet });
  assert.deepEqual(readSettings(dataDir), { downloadDir: '/x/y', ytDlpLastCheck: 42 });
});
