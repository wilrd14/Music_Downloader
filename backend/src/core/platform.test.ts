import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { defaultLocalDataDir, defaultMusicDir, findBinary, findStaticDir, isInside, parseMode } from './platform';

test('parseMode: local por defecto, server explícito, resto es un error', () => {
  assert.equal(parseMode(undefined), 'local');
  assert.equal(parseMode(''), 'local');
  assert.equal(parseMode('local'), 'local');
  assert.equal(parseMode(' SERVER '), 'server');
  assert.throws(() => parseMode('prod'), /TUNEDROP_MODE/);
});

test('carpeta de datos local según el sistema operativo', () => {
  assert.equal(
    defaultLocalDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, home: 'C:\\Users\\ana' }),
    'C:\\Users\\ana\\AppData\\Local\\tunedrop',
  );
  assert.equal(
    defaultLocalDataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\ana' }),
    'C:\\Users\\ana\\AppData\\Local\\tunedrop',
  );
  assert.equal(
    defaultLocalDataDir({ platform: 'darwin', env: {}, home: '/Users/ana' }),
    '/Users/ana/Library/Application Support/tunedrop',
  );
  assert.equal(defaultLocalDataDir({ platform: 'linux', env: {}, home: '/home/ana' }), '/home/ana/.local/share/tunedrop');
  assert.equal(
    defaultLocalDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/xdg' }, home: '/home/ana' }),
    '/data/xdg/tunedrop',
  );
});

test('carpeta de música por defecto: <home>/Music/tunedrop', () => {
  assert.equal(defaultMusicDir({ platform: 'linux', home: '/home/ana' }), '/home/ana/Music/tunedrop');
  assert.equal(defaultMusicDir({ platform: 'win32', home: 'C:\\Users\\ana' }), 'C:\\Users\\ana\\Music\\tunedrop');
});

test('findBinary: primero bin empaquetado, luego variable de entorno, luego PATH', () => {
  const present = new Set(['/app/bin/yt-dlp']);
  const isFile = (p: string) => present.has(p);
  const base = { binDir: '/app/bin', platform: 'linux' as const, isFile };

  assert.deepEqual(findBinary('yt-dlp', { ...base, envOverride: '/usr/local/bin/yt-dlp' }), { path: '/app/bin/yt-dlp', source: 'bundled' });
  assert.deepEqual(findBinary('ffmpeg', { ...base, envOverride: '/opt/ff' }), { path: '/opt/ff', source: 'env' });
  assert.deepEqual(findBinary('ffmpeg', { ...base, envOverride: '  ' }), { path: null, source: 'path' });
  assert.deepEqual(findBinary('ffmpeg', base), { path: null, source: 'path' });
});

test('findBinary: en Windows busca .exe', () => {
  const isFile = (p: string) => p === 'C:\\app\\bin\\ffmpeg.exe';
  const opts = { binDir: 'C:\\app\\bin', platform: 'win32' as const, isFile };
  assert.deepEqual(findBinary('ffmpeg', opts), { path: 'C:\\app\\bin\\ffmpeg.exe', source: 'bundled' });
  assert.equal(findBinary('yt-dlp', opts).source, 'path');
});

test('findBinary: con archivos reales (una carpeta con el nombre no cuenta como binario)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-bin-'));
  try {
    const name = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    fs.mkdirSync(path.join(dir, name));
    assert.equal(findBinary('yt-dlp', { binDir: dir }).source, 'path');
    fs.rmSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
    assert.deepEqual(findBinary('yt-dlp', { binDir: dir }), { path: path.join(dir, name), source: 'bundled' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('findStaticDir: STATIC_DIR, luego <app>/web, luego el frontend del repo', () => {
  const root = path.resolve('/app/backend');
  const web = path.join(root, 'web');
  const repo = path.resolve(root, '../frontend/dist');
  const fromDist = path.resolve(root, '../../frontend/dist');
  assert.equal(findStaticDir(root, '/otro/web', () => true), path.resolve('/otro/web'));
  assert.equal(findStaticDir(root, null, () => true), web);
  assert.equal(findStaticDir(root, null, (d) => d === repo || d === fromDist), repo);
  assert.equal(findStaticDir(root, null, (d) => d === fromDist), fromDist);
  assert.equal(findStaticDir(root, null, () => false), repo);
});

test('isInside: contención por segmentos, no por prefijo de texto', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/b'), false);
  assert.equal(isInside('/a/b', '/a/b', true), true);
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a/b/../c'), false);
  assert.equal(isInside('/a/b', '/a/b/..x/y'), true);
  assert.equal(isInside('C:\\Music', 'c:\\music\\Lista', false, 'win32'), true);
  assert.equal(isInside('C:\\Music', 'D:\\Music\\Lista', false, 'win32'), false);
});
