import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { config, UserError } from '../core';
import type { RunResult } from './proc';
import { tagAudio, type TagMeta } from './tagger';

const meta: TagMeta = { title: 'Canción\u0000\n', artist: 'Artista', album: 'Álbum', coverUrl: 'https://i.scdn.co/image/abc' };
const okRes: RunResult = { code: 0, stdout: '', stderr: '' };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-tag-'));
const fakeFetch = (bytes: Uint8Array | null, init: ResponseInit = {}): typeof fetch =>
  (async () => (bytes ? new Response(new Blob([bytes as BlobPart]), init) : new Response('x', { status: 404 }))) as typeof fetch;

/** runCmd falso: registra los argumentos y, si `code` es 0, escribe el archivo de salida (último arg). */
function fakeRun(codes: number[] = [0]) {
  const calls: string[][] = [];
  const fn = async (_cmd: string, args: string[]): Promise<RunResult> => {
    calls.push(args);
    const code = codes[Math.min(calls.length - 1, codes.length - 1)] as number;
    if (code === 0) fs.writeFileSync(args[args.length - 1] as string, 'tagged');
    return code === 0 ? okRes : { code, stdout: '', stderr: 'error' };
  };
  return { calls, fn };
}

const files = (dir: string) => fs.readdirSync(dir).sort();

test('tagAudio mp3: argumentos de ffmpeg, reemplaza el original y limpia temporales', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'a.mp3');
    fs.writeFileSync(file, 'original');
    const { calls, fn } = fakeRun();
    await tagAudio(file, 'mp3', meta, { fetch: fakeFetch(new Uint8Array([1, 2, 3])), runCmd: fn });

    assert.equal(fs.readFileSync(file, 'utf8'), 'tagged');
    assert.deepEqual(files(dir), ['a.mp3']);
    assert.equal(calls.length, 1);
    const args = calls[0] as string[];
    const has = (...seq: string[]) => args.join('\u0001').includes(seq.join('\u0001'));
    assert.ok(has('-i', file, '-i'));
    assert.ok(has('-map', '0:a', '-map', '1:v'));
    assert.ok(has('-c', 'copy'));
    assert.ok(has('-map_metadata', '-1'));
    assert.ok(has('-metadata', 'title=Canción')); // sin caracteres de control
    assert.ok(has('-metadata', 'artist=Artista'));
    assert.ok(has('-metadata', 'album_artist=Artista'));
    assert.ok(has('-metadata', 'album=Álbum'));
    assert.ok(has('-id3v2_version', '3'));
    assert.ok(has('-metadata:s:v', 'title=Album cover'));
    assert.ok(has('-metadata:s:v', 'comment=Cover (front)'));
    assert.ok(!args.includes('-disposition:v:0'));
    assert.ok(args[args.length - 1]?.endsWith('.mp3'));
    assert.notEqual(args[args.length - 1], file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tagAudio m4a: usa attached_pic', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'a.m4a');
    fs.writeFileSync(file, 'original');
    const { calls, fn } = fakeRun();
    await tagAudio(file, 'm4a', meta, { fetch: fakeFetch(new Uint8Array([1])), runCmd: fn });
    const args = calls[0] as string[];
    assert.ok(args.join(' ').includes('-disposition:v:0 attached_pic'));
    assert.ok(!args.includes('-id3v2_version'));
    assert.ok(args[args.length - 1]?.endsWith('.m4a'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('portada no disponible (404, http, host no permitido, demasiado grande): etiqueta solo el texto', async () => {
  const dir = tmp();
  try {
    const big = { headers: { 'content-length': String(6 * 1024 * 1024) } };
    for (const [coverUrl, f] of [
      ['https://i.scdn.co/c.jpg', fakeFetch(null)],
      ['http://i.scdn.co/c.jpg', fakeFetch(new Uint8Array([1]))],
      ['https://evil.test/c.jpg', fakeFetch(new Uint8Array([1]))], // host fuera de la lista permitida
      ['https://i.scdn.co/c.jpg', fakeFetch(new Uint8Array([1]), big)],
      ['https://i.scdn.co/c.jpg', (async () => Promise.reject(new Error('red'))) as typeof fetch],
      [null, fakeFetch(new Uint8Array([1]))],
    ] as const) {
      const file = path.join(dir, 'a.mp3');
      fs.writeFileSync(file, 'original');
      const { calls, fn } = fakeRun();
      await tagAudio(file, 'mp3', { ...meta, coverUrl }, { fetch: f, runCmd: fn });
      assert.equal(calls.length, 1, String(coverUrl));
      assert.ok(!(calls[0] as string[]).includes('1:v'));
      assert.equal(fs.readFileSync(file, 'utf8'), 'tagged');
      assert.deepEqual(files(dir), ['a.mp3']);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('si ffmpeg falla con portada, reintenta sin ella', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'a.mp3');
    fs.writeFileSync(file, 'original');
    const { calls, fn } = fakeRun([1, 0]);
    await tagAudio(file, 'mp3', meta, { fetch: fakeFetch(new Uint8Array([1])), runCmd: fn });
    assert.equal(calls.length, 2);
    assert.ok((calls[0] as string[]).includes('1:v'));
    assert.ok(!(calls[1] as string[]).includes('1:v'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'tagged');
    assert.deepEqual(files(dir), ['a.mp3']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('si todo falla lanza UserError y el original queda intacto', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'a.mp3');
    fs.writeFileSync(file, 'original');
    const { fn } = fakeRun([1]);
    await assert.rejects(
      tagAudio(file, 'mp3', meta, { fetch: fakeFetch(new Uint8Array([1])), runCmd: fn }),
      UserError,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.deepEqual(files(dir), ['a.mp3']);

    // ffmpeg "exitoso" pero sin salida, y binario inexistente.
    await assert.rejects(tagAudio(file, 'mp3', meta, { runCmd: async () => okRes }), UserError);
    await assert.rejects(
      tagAudio(file, 'mp3', meta, {
        runCmd: async () => {
          throw new UserError('No se encontró "ffmpeg".', 503);
        },
      }),
      (e: unknown) => e instanceof UserError && e.status === 503,
    );
    assert.equal(fs.readFileSync(file, 'utf8'), 'original');
    assert.deepEqual(files(dir), ['a.mp3']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Integración real con ffmpeg/ffprobe (se omite si no están disponibles) ----

function findTools(): { dir: string | null; ffmpeg: string; ffprobe: string } | null {
  const works = (bin: string) => spawnSync(bin, ['-version'], { windowsHide: true }).status === 0;
  if (works('ffmpeg') && works('ffprobe')) return { dir: null, ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const pkg of fs.readdirSync(root)) {
      const pkgDir = path.join(root, pkg);
      for (const sub of fs.readdirSync(pkgDir, { withFileTypes: true })) {
        const bin = path.join(pkgDir, sub.name, 'bin');
        const ffmpeg = path.join(bin, 'ffmpeg.exe');
        const ffprobe = path.join(bin, 'ffprobe.exe');
        if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) return { dir: bin, ffmpeg, ffprobe };
      }
    }
  } catch {
    // sin WinGet
  }
  return null;
}

const tools = findTools();

for (const format of ['mp3', 'm4a'] as const) {
  test(`integración real (${format}): etiquetas y portada legibles con ffprobe`, { skip: !tools }, async () => {
    const t = tools!;
    const dir = tmp();
    const prevPath = config.ffmpegPath;
    config.ffmpegPath = t.dir;
    try {
      const file = path.join(dir, `song.${format}`);
      const cover = path.join(dir, 'cover.jpg');
      const gen = (args: string[]) => {
        const r = spawnSync(t.ffmpeg, ['-y', '-v', 'error', ...args], { windowsHide: true });
        assert.equal(r.status, 0, String(r.stderr));
      };
      gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...(format === 'mp3' ? ['-c:a', 'libmp3lame'] : ['-c:a', 'aac']), file]);
      gen(['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', cover]);

      const jpg = fs.readFileSync(cover);
      await tagAudio(file, format, { title: 'Mi Canción', artist: 'Mi Artista', album: 'Mi Álbum', coverUrl: 'https://i.scdn.co/c.jpg' }, {
        fetch: fakeFetch(new Uint8Array(jpg)),
      });

      const probe = spawnSync(
        t.ffprobe,
        ['-v', 'error', '-show_entries', 'format_tags:stream=codec_type', '-of', 'json', file],
        { windowsHide: true, encoding: 'utf8' },
      );
      assert.equal(probe.status, 0, probe.stderr);
      const info = JSON.parse(probe.stdout) as { format: { tags: Record<string, string> }; streams: { codec_type: string }[] };
      const tags = Object.fromEntries(Object.entries(info.format.tags).map(([k, v]) => [k.toLowerCase(), v]));
      assert.equal(tags.title, 'Mi Canción');
      assert.equal(tags.artist, 'Mi Artista');
      assert.equal(tags.album, 'Mi Álbum');
      assert.ok(info.streams.some((s) => s.codec_type === 'video'), 'falta el stream de portada');
      assert.ok(info.streams.some((s) => s.codec_type === 'audio'));
      assert.deepEqual(files(dir).sort(), ['cover.jpg', `song.${format}`]);
    } finally {
      config.ffmpegPath = prevPath;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
