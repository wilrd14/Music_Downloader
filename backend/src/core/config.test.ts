import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { defaultLocalDataDir } from './platform';

/**
 * `config` se evalúa al importarse, así que cada escenario de variables de entorno se prueba en un proceso
 * nuevo (con tsx), sin tocar el entorno de esta prueba ni leer backend/.env.
 */
const configUrl = pathToFileURL(path.resolve(import.meta.dirname, 'config.ts')).href;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-cfg-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

type Out = { mode: string; dataDir: string; ytDlpPath: string; ytDlpSource: string; ffmpegPath: string | null; ytDlpAutoUpdate: boolean; downloadDirEnv: string | null; staticDir: string; binDir: string };

function loadConfig(env: Record<string, string>): { status: number | null; out?: Out; stderr: string } {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    NODE_TEST_CONTEXT: 'child-v8', // config no lee backend/.env bajo node --test
    HOME: tmp,
    USERPROFILE: tmp,
    LOCALAPPDATA: path.join(tmp, 'localappdata'),
    XDG_DATA_HOME: path.join(tmp, 'xdg'),
  };
  const code = `const { config } = await import(${JSON.stringify(configUrl)}); console.log('@@' + JSON.stringify(config));`;
  const res = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    env: { ...base, ...env },
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
  });
  const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith('@@'));
  return { status: res.status, out: line ? (JSON.parse(line.slice(2)) as Out) : undefined, stderr: res.stderr };
}

test('modo local por defecto: datos en la carpeta de aplicación del sistema y auto-actualización activa', () => {
  const { out, status } = loadConfig({});
  assert.equal(status, 0);
  assert.equal(out!.mode, 'local');
  const expected = defaultLocalDataDir({ env: { LOCALAPPDATA: path.join(tmp, 'localappdata'), XDG_DATA_HOME: path.join(tmp, 'xdg') }, home: tmp });
  assert.equal(out!.dataDir, expected);
  assert.equal(out!.ytDlpAutoUpdate, true);
});

test('modo servidor: backend/data por defecto y sin auto-actualización', () => {
  const { out } = loadConfig({ TUNEDROP_MODE: 'server' });
  assert.equal(out!.mode, 'server');
  assert.equal(out!.dataDir, path.resolve(import.meta.dirname, '../../data'));
  assert.equal(out!.ytDlpAutoUpdate, false);
});

test('DATA_DIR manda en ambos modos; YT_DLP_AUTO_UPDATE=0 desactiva la actualización', () => {
  const dataDir = path.join(tmp, 'mis-datos');
  for (const mode of ['local', 'server']) {
    assert.equal(loadConfig({ TUNEDROP_MODE: mode, DATA_DIR: dataDir }).out!.dataDir, dataDir);
  }
  assert.equal(loadConfig({ YT_DLP_AUTO_UPDATE: '0' }).out!.ytDlpAutoUpdate, false);
  assert.equal(loadConfig({ YT_DLP_AUTO_UPDATE: 'false' }).out!.ytDlpAutoUpdate, false);
  assert.equal(loadConfig({ YT_DLP_AUTO_UPDATE: '1' }).out!.ytDlpAutoUpdate, true);
});

test('un TUNEDROP_MODE desconocido impide arrancar', () => {
  const { status, stderr } = loadConfig({ TUNEDROP_MODE: 'produccion' });
  assert.notEqual(status, 0);
  assert.match(stderr, /TUNEDROP_MODE/);
});

test('DOWNLOAD_DIR se refleja en la configuración', () => {
  assert.equal(loadConfig({ DOWNLOAD_DIR: path.join(tmp, 'musica') }).out!.downloadDirEnv, path.join(tmp, 'musica'));
  assert.equal(loadConfig({}).out!.downloadDirEnv, null);
});

test('binarios: bin empaquetado (TUNEDROP_BIN_DIR) > YT_DLP_PATH/FFMPEG_PATH > PATH', () => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const exe = (n: string) => (process.platform === 'win32' ? `${n}.exe` : n);
  const envs = { TUNEDROP_BIN_DIR: bin, YT_DLP_PATH: path.join(tmp, 'otro-yt-dlp'), FFMPEG_PATH: path.join(tmp, 'otro-ffmpeg') };

  // bin vacío: gana el override del entorno
  let { out } = loadConfig(envs);
  assert.equal(out!.ytDlpSource, 'env');
  assert.equal(out!.ytDlpPath, envs.YT_DLP_PATH);
  assert.equal(out!.ffmpegPath, envs.FFMPEG_PATH);

  // sin bin ni overrides: PATH (nombre a secas; ffmpeg = null)
  ({ out } = loadConfig({ TUNEDROP_BIN_DIR: bin }));
  assert.equal(out!.ytDlpSource, 'path');
  assert.equal(out!.ytDlpPath, 'yt-dlp');
  assert.equal(out!.ffmpegPath, null);

  // con binarios empaquetados: ganan al override
  fs.writeFileSync(path.join(bin, exe('yt-dlp')), '');
  fs.writeFileSync(path.join(bin, exe('ffmpeg')), '');
  ({ out } = loadConfig(envs));
  assert.equal(out!.ytDlpSource, 'bundled');
  assert.equal(out!.ytDlpPath, path.join(bin, exe('yt-dlp')));
  assert.equal(out!.ffmpegPath, path.join(bin, exe('ffmpeg')));
});

test('STATIC_DIR manda sobre la búsqueda automática de la interfaz', () => {
  const dir = path.join(tmp, 'mi-web');
  assert.equal(loadConfig({ STATIC_DIR: dir }).out!.staticDir, dir);
});
