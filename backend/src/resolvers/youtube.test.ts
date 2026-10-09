import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { UserError } from '../core';
import type { RunOptions, RunResult } from './proc';
import { classify, createYoutubeResolver, parseUrl, youtube } from './youtube';

const kindOf = (raw: string) => {
  const u = parseUrl(raw);
  return u ? classify(u) : null;
};

test('clasifica enlaces de video', () => {
  assert.equal(kindOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'track');
  assert.equal(kindOf('https://youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'track');
  assert.equal(kindOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'track');
  assert.equal(kindOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM'), 'track');
  assert.equal(kindOf('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'track');
  assert.equal(kindOf('https://www.youtube.com/shorts/abc123_-XYZ'), 'track');
  assert.equal(kindOf('  https://youtu.be/dQw4w9WgXcQ  '), 'track');
});

test('clasifica playlists', () => {
  assert.equal(kindOf('https://www.youtube.com/playlist?list=PL123'), 'playlist');
  assert.equal(kindOf('https://music.youtube.com/playlist?list=OLAK5uy'), 'playlist');
});

test('rechaza enlaces no soportados', () => {
  assert.equal(kindOf('https://www.youtube.com/playlist'), null);
  assert.equal(kindOf('https://www.youtube.com/playlist?list='), null);
  assert.equal(kindOf('https://www.youtube.com/watch'), null);
  assert.equal(kindOf('https://youtu.be/'), null);
  assert.equal(kindOf('https://www.youtube.com/@canal'), null);
  assert.equal(kindOf('https://www.youtube.com/channel/UC123'), null);
  assert.equal(kindOf('https://www.youtube.com/c/canal/videos'), null);
  assert.equal(kindOf('https://evil.com/watch?v=abc'), null);
  assert.equal(kindOf('https://youtube.com.evil.com/watch?v=abc'), null);
  assert.equal(kindOf('https://notyoutube.com/watch?v=abc'), null);
});

test('canHandle rechaza no-URLs y protocolos raros', () => {
  for (const bad of [
    '',
    'hola',
    'youtube.com/watch?v=abc',
    'ftp://youtube.com/watch?v=a',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(youtube.canHandle(bad), false, bad);
  }
  assert.equal(youtube.canHandle('https://youtu.be/abc'), true);
});

test('seguridad: solo el puerto estándar y sin credenciales llegan a yt-dlp', () => {
  for (const bad of [
    'https://www.youtube.com:8080/watch?v=abc',
    'http://youtu.be:81/abc',
    'https://usuario:clave@www.youtube.com/watch?v=abc',
    'https://usuario@youtu.be/abc',
    'https://www.youtube.com./watch?v=abc',
    'https://www.youtube.com.evil.test/watch?v=abc',
    'https://www.youtube.com@evil.test/watch?v=abc',
  ]) {
    assert.equal(youtube.canHandle(bad), false, bad);
  }
  assert.equal(youtube.canHandle('https://www.youtube.com:443/watch?v=abc'), true); // puerto por defecto
});

test('seguridad: ids con caracteres raros se descartan (van a una URL y a la ruta de la miniatura)', async () => {
  const r = createYoutubeResolver(async () =>
    ok(
      JSON.stringify({
        title: 'PL',
        entries: [
          { id: 'ok-_1', title: 'bueno' },
          { id: 'a&b=c', title: 'malo 1' },
          { id: 'x/../y', title: 'malo 2' },
          { id: 'z#frag', title: 'malo 3' },
          { id: '-oexec', title: 'empieza por guion pero es un id válido' },
        ],
      }),
    ),
  );
  const src = await r.resolve('https://www.youtube.com/playlist?list=PL1');
  assert.deepEqual(src.tracks.map((t) => t.id), ['ok-_1', '-oexec']);
});

test('seguridad: con el yt-dlp empaquetado se ignoran los archivos de configuración (yt-dlp.conf con --exec)', async () => {
  const seen: Record<string, string[]> = {};
  const mk = (source: 'bundled' | 'path', key: string) =>
    createYoutubeResolver(async (_c, args) => {
      seen[key] = args;
      return ok(JSON.stringify({ id: 'abc', title: 't', channel: 'a' }));
    }, source);
  await mk('bundled', 'b').resolve('https://youtu.be/abc');
  await mk('path', 'p').resolve('https://youtu.be/abc');
  assert.equal(seen.b?.[0], '--ignore-config');
  assert.ok(!seen.p?.includes('--ignore-config'));
  assert.equal(seen.b?.at(-2), '--'); // la URL sigue yendo tras `--`

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-yt-'));
  try {
    let dl: string[] = [];
    const r = createYoutubeResolver(async (_c, args) => {
      dl = args;
      fs.writeFileSync(path.join(dir, 'x.mp3'), 'x');
      return { code: 0, stdout: '', stderr: '' };
    }, 'bundled');
    await r.download(
      { id: 'abc', title: 't', artist: 'a', durationSec: null, thumbnail: null, url: 'https://www.youtube.com/watch?v=abc' },
      { outDir: dir, fileBase: 'x', format: 'mp3', onProgress: () => {} },
    );
    assert.equal(dl[0], '--ignore-config');
    assert.equal(dl.at(-2), '--');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: '' });

test('resolve: video individual', async () => {
  let seen: string[] = [];
  const r = createYoutubeResolver(async (_cmd, args) => {
    seen = args;
    return ok(JSON.stringify({ id: 'abc', title: 'Canción', channel: 'Artista - Topic', duration: 200.4 }));
  });
  const src = await r.resolve('https://youtu.be/abc');
  assert.equal(src.kind, 'track');
  assert.equal(src.tracks.length, 1);
  const t = src.tracks[0];
  assert.deepEqual(
    { id: t?.id, artist: t?.artist, d: t?.durationSec, url: t?.url },
    { id: 'abc', artist: 'Artista', d: 200, url: 'https://www.youtube.com/watch?v=abc' },
  );
  assert.ok(seen.includes('--no-playlist'));
});

test('resolve: playlist filtra entradas no disponibles', async () => {
  const r = createYoutubeResolver(async (_c, args) => {
    assert.ok(args.includes('--yes-playlist'));
    return ok(
      JSON.stringify({
        title: 'Mi lista',
        entries: [
          { id: 'a', title: 'Uno', uploader: 'X' },
          null,
          { id: 'b', title: '[Private video]' },
          { id: 'c', title: '[Deleted video]' },
          { title: 'sin id' },
          { id: 'd', title: 'Dos', track: 'Dos (oficial)', artist: 'Y' },
        ],
      }),
    );
  });
  const src = await r.resolve('https://www.youtube.com/playlist?list=PL1');
  assert.equal(src.kind, 'playlist');
  assert.equal(src.title, 'Mi lista');
  assert.deepEqual(
    src.tracks.map((t) => [t.id, t.title, t.artist]),
    [
      ['a', 'Uno', 'X'],
      ['d', 'Dos (oficial)', 'Y'],
    ],
  );
});

test('resolve: errores de yt-dlp y JSON inválido', async () => {
  const fail = createYoutubeResolver(async () => ({ code: 1, stdout: '', stderr: 'ERROR: Private video' }));
  await assert.rejects(
    fail.resolve('https://youtu.be/abc'),
    (e: unknown) => e instanceof UserError && /privado/.test(e.message),
  );

  const bad = createYoutubeResolver(async () => ok('no es json'));
  await assert.rejects(
    bad.resolve('https://youtu.be/abc'),
    (e: unknown) => e instanceof UserError && e.status === 502,
  );

  const empty = createYoutubeResolver(async () => ok(JSON.stringify({ title: 'x', entries: [] })));
  await assert.rejects(empty.resolve('https://www.youtube.com/playlist?list=PL1'), UserError);

  await assert.rejects(youtube.resolve('https://evil.com/x'), UserError);
});

const track = {
  id: 'abc',
  title: 't',
  artist: 'a',
  durationSec: null,
  thumbnail: null,
  url: 'https://www.youtube.com/watch?v=abc',
};

test('download: parsea progreso, escapa % en la plantilla y devuelve el archivo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-yt-'));
  try {
    let args: string[] = [];
    const events: [number, string][] = [];
    const r = createYoutubeResolver(async (_cmd, a, opts?: RunOptions) => {
      args = a;
      for (const line of [
        '[youtube] abc: Downloading webpage',
        '[download]   0.0% of 3.00MiB at Unknown B/s ETA Unknown',
        '[download]  50.0% of 3.00MiB at 1.00MiB/s ETA 00:01',
        '[download] 100% of 3.00MiB in 00:03',
        '[ExtractAudio] Destination: x.mp3',
        '[download] 10.0% of thumbnail', // ignorado: ya en conversión
      ])
        opts?.onLine?.(line);
      fs.writeFileSync(path.join(dir, '100% Pure.mp3'), 'x');
      return { code: 0, stdout: '', stderr: '' };
    });
    const file = await r.download(track, {
      outDir: dir,
      fileBase: '100% Pure',
      format: 'mp3',
      onProgress: (p, ph) => events.push([p, ph]),
    });
    assert.equal(file, path.join(dir, '100% Pure.mp3'));
    assert.deepEqual(events, [
      [0, 'downloading'],
      [45, 'downloading'],
      [90, 'downloading'],
      [92, 'converting'],
      [100, 'converting'],
    ]);
    const out = args[args.indexOf('-o') + 1] as string;
    assert.ok(out.endsWith('100%% Pure.%(ext)s'), out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('download: falla si no se produjo archivo o yt-dlp devuelve error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-yt-'));
  const opts = { outDir: dir, fileBase: 'x', format: 'm4a' as const, onProgress: () => {} };
  try {
    await assert.rejects(
      createYoutubeResolver(async () => ({ code: 0, stdout: '', stderr: '' })).download(track, opts),
      UserError,
    );
    await assert.rejects(
      createYoutubeResolver(async () => ({ code: 1, stdout: '', stderr: 'HTTP Error 429' })).download(track, opts),
      (e: unknown) => e instanceof UserError && /Demasiadas/.test(e.message),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('download: siempre pasa las opciones de metadatos y miniatura', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-yt-'));
  try {
    const seen: string[][] = [];
    const r = createYoutubeResolver(async (_cmd, a) => {
      seen.push(a);
      fs.writeFileSync(path.join(dir, 'x.mp3'), 'x');
      return { code: 0, stdout: '', stderr: '' };
    });
    const base = { outDir: dir, fileBase: 'x', format: 'mp3' as const, onProgress: () => {} };
    await r.download(track, base);
    for (const flag of ['--embed-metadata', '--embed-thumbnail', '--convert-thumbnails'])
      assert.ok(seen[0]!.includes(flag), flag);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
