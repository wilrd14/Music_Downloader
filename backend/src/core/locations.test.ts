import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-loc-'));
process.env.DATA_DIR = path.join(tmp, 'data'); // antes de importar config
const { checkDownloadDirShape, jobOutDir, resolveDownloadDir, validateDownloadDir } = await import('./locations');
const { readSettings, updateSettings, settingsPath } = await import('./settings');
const { UserError } = await import('./errors');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const win = (raw: unknown) => checkDownloadDirShape(raw, { platform: 'win32', home: 'C:\\Users\\ana' });
const nix = (raw: unknown) => checkDownloadDirShape(raw, { platform: 'linux', home: '/home/ana' });
const okDir = (r: ReturnType<typeof win>) => (r.ok ? r.dir : `ERROR: ${r.error}`);

test('forma de la ruta (Windows): acepta rutas con unidad y rechaza lo demás', () => {
  assert.equal(okDir(win('C:\\Users\\ana\\Music\\tunedrop')), 'C:\\Users\\ana\\Music\\tunedrop');
  assert.equal(okDir(win('  D:/Musica/../Musica/Mi lista\\ ')), 'D:\\Musica\\Mi lista');
  assert.equal(okDir(win('c:\\users\\ana\\Music')), 'c:\\users\\ana\\Music');
  for (const bad of [
    '',
    '   ',
    'Music', // relativa
    '.\\Music',
    '..\\Music',
    '\\Music', // sin unidad
    'C:Music', // relativa a la unidad
    '\\\\servidor\\recurso\\musica', // UNC
    '//servidor/recurso/musica',
    '\\\\?\\C:\\Music', // prefijo de ruta larga
    '\\\\.\\PhysicalDrive0',
    'C:\\', // raíz
    'D:/',
    'C:\\Windows',
    'c:\\windows\\system32',
    'C:\\Program Files',
    'C:\\Program Files (x86)\\App',
    'C:\\ProgramData',
    'C:\\Users', // contenedor de cuentas
    'C:\\Users\\ana', // la carpeta personal completa
    'C:\\Users\\ana\\..\\..\\Windows', // se normaliza y cae en una zona del sistema
    'C:\\Music\\a\u0000b',
    `C:\\${'a'.repeat(1100)}`,
    undefined,
    null,
    42,
    { toString: () => 'C:\\Music' },
  ]) {
    assert.equal(win(bad).ok, false, JSON.stringify(bad));
  }
});

test('seguridad (Windows): rechaza nombres de dispositivo, puntos/espacios finales, flujos ":" y el menú Inicio', () => {
  // Hallazgo de la auditoría: Node creaba `C:\CON` y `C:\Windows.` (una carpeta distinta de C:\Windows que
  // Explorer confunde con ella) y no se bloqueaba la carpeta Inicio (Startup) del usuario.
  for (const bad of [
    'C:\\CON',
    'C:\\nul',
    'C:\\Users\\ana\\Music\\NUL',
    'C:\\Users\\ana\\Music\\aux.txt',
    'C:\\Users\\ana\\Music\\COM1',
    'C:\\Users\\ana\\Music\\LPT\u00B9',
    'C:\\Windows.',
    'C:\\Users\\ana\\Music\\tunedrop.',
    'C:\\Users\\ana\\Music\\a. \\b',
    'C:\\Users\\ana\\Music:secreto',
    'C:\\Users\\ana\\Music\\a::$DATA',
    'C:\\Users\\ana\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
    'c:\\users\\ana\\appdata\\roaming\\microsoft\\windows\\start menu\\programs\\startup\\musica',
    'C:\\Users\\ana\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu',
  ]) {
    assert.equal(win(bad).ok, false, bad);
  }
  // lo normal sigue valiendo (nombres que contienen, pero no son, un nombre reservado)
  for (const good of ['C:\\Users\\ana\\Music\\console', 'C:\\Users\\ana\\Music\\Mi.musica', 'D:\\Musica\\COM1x', 'C:\\Users\\ana\\AppData\\Roaming\\Music']) {
    assert.equal(win(good).ok, true, good);
  }
});

test('forma de la ruta (Linux/macOS): acepta rutas absolutas y rechaza raíz, sistema y relativas', () => {
  assert.equal(okDir(nix('/home/ana/Music/tunedrop')), '/home/ana/Music/tunedrop');
  assert.equal(okDir(nix('/home/ana/Music//a/../tunedrop/')), '/home/ana/Music/tunedrop');
  assert.equal(okDir(nix('/data/musica')), '/data/musica');
  for (const bad of [
    '',
    'Music',
    '~/Music',
    './Music',
    '../Music',
    '/',
    '/etc',
    '/etc/cron.d',
    '/usr/lib/x',
    '/bin',
    '/sbin',
    '/boot',
    '/dev/shm',
    '/proc/1',
    '/sys',
    '/var/lib',
    '/root',
    '/System/Library',
    '/Library/Music',
    '/Applications',
    '/home', // contenedor de cuentas
    '/Users',
    '/home/ana', // carpeta personal completa
    '/home/ana/../../etc', // normaliza a /etc
    '/music/\u0001',
    'C:\\Music',
  ]) {
    assert.equal(nix(bad).ok, false, JSON.stringify(bad));
  }
});

test('mensajes de error en español y accionables', () => {
  const r = win('Music');
  assert.ok(!r.ok && /ruta completa/i.test(r.error));
  const root = nix('/');
  assert.ok(!root.ok && /ra[ií]z/i.test(root.error));
});

test('validateDownloadDir: crea la carpeta, comprueba que se puede escribir y no deja restos', () => {
  const dir = path.join(tmp, 'musica', 'nueva');
  assert.equal(validateDownloadDir(dir), path.resolve(dir));
  assert.ok(fs.statSync(dir).isDirectory());
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('validateDownloadDir: rechaza archivos, relativas y raíces con UserError 400', () => {
  const file = path.join(tmp, 'archivo.txt');
  fs.writeFileSync(file, 'x');
  for (const bad of [file, 'relativa/musica', '', path.parse(tmp).root]) {
    assert.throws(
      () => validateDownloadDir(bad),
      (err: unknown) => err instanceof UserError && err.status === 400,
      String(bad),
    );
  }
});

test('validateDownloadDir: un enlace simbólico hacia una zona del sistema se rechaza', (t) => {
  const link = path.join(tmp, 'enlace');
  const target = process.platform === 'win32' ? (process.env.SystemRoot ?? 'C:\\Windows') : '/etc';
  try {
    fs.symlinkSync(target, link, 'junction');
  } catch {
    t.skip('no se pueden crear enlaces simbólicos aquí');
    return;
  }
  assert.throws(() => validateDownloadDir(link), UserError);
});

test('settings.json: lectura tolerante y escritura que conserva campos', () => {
  const dir = path.join(tmp, 'settings');
  assert.deepEqual(readSettings(dir), {});
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(dir), '{ no es json');
  assert.deepEqual(readSettings(dir), {});
  updateSettings(dir, { downloadDir: '/a/b' });
  updateSettings(dir, { ytDlpLastCheck: 7 });
  assert.deepEqual(readSettings(dir), { downloadDir: '/a/b', ytDlpLastCheck: 7 });
  fs.writeFileSync(settingsPath(dir), JSON.stringify({ downloadDir: 5, ytDlpLastCheck: 'x', otro: 1 }));
  assert.deepEqual(readSettings(dir), {});
});

test('carpeta efectiva: ajuste guardado > DOWNLOAD_DIR > <home>/Music/tunedrop', () => {
  const dataDir = path.join(tmp, 'prio');
  const env = path.join(tmp, 'desde-env');
  const saved = path.join(tmp, 'guardada');
  const home = path.join(tmp, 'home');
  assert.equal(resolveDownloadDir({ dataDir, envDir: null, home }), path.join(home, 'Music', 'tunedrop'));
  assert.equal(resolveDownloadDir({ dataDir, envDir: env, home }), path.resolve(env));
  updateSettings(dataDir, { downloadDir: saved });
  assert.equal(resolveDownloadDir({ dataDir, envDir: env, home }), path.resolve(saved));
  // un ajuste manipulado a mano (relativo) se ignora
  updateSettings(dataDir, { downloadDir: 'relativa' });
  assert.equal(resolveDownloadDir({ dataDir, envDir: env, home }), path.resolve(env));
  assert.equal(resolveDownloadDir({ dataDir, envDir: 'tambien-relativa', home }), path.join(home, 'Music', 'tunedrop'));
});

test('jobOutDir: pista suelta en la carpeta; playlist en una subcarpeta con el título saneado', () => {
  const base = path.join(tmp, 'Musica');
  assert.equal(jobOutDir(base, { kind: 'track', title: 'Lo que sea' }), base);
  assert.equal(jobOutDir(base, { kind: 'playlist', title: 'Mi Lista: "rara"/ñ' }), path.join(base, 'Mi Lista_ _rara__ñ'));
});

test('jobOutDir: un título malicioso no puede salirse de la carpeta de música', () => {
  const base = path.join(tmp, 'Musica');
  for (const title of ['..', '../../etc', '..\\..\\Windows', '/etc/passwd', 'C:\\Windows', '....', ' . ', 'a/../../b']) {
    const out = jobOutDir(base, { kind: 'playlist', title });
    assert.equal(path.dirname(out), base, title);
    assert.ok(path.basename(out) !== '..' && path.basename(out) !== '.', title);
  }
});
