import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reserveFileBase } from './naming';

test('nombre libre: se usa tal cual', () => {
  const r = reserveFileBase('/m', 'Artista - Tema', 'mp3', () => false, new Set());
  assert.equal(r.fileBase, 'Artista - Tema');
});

test('si existe se añade " (1)", " (2)"... antes de la extensión', () => {
  const existing = new Set([path.join('/m', 'A - B.mp3'), path.join('/m', 'A - B (1).mp3')]);
  const exists = (p: string) => existing.has(p);
  assert.equal(reserveFileBase('/m', 'A - B', 'mp3', exists, new Set()).fileBase, 'A - B (2)');
  // otra extensión no choca
  assert.equal(reserveFileBase('/m', 'A - B', 'm4a', exists, new Set()).fileBase, 'A - B');
});

test('dos reservas simultáneas del mismo nombre no coinciden; liberar permite reutilizar', () => {
  const taken = new Set<string>();
  const a = reserveFileBase('/m', 'X', 'mp3', () => false, taken);
  const b = reserveFileBase('/m', 'X', 'mp3', () => false, taken);
  assert.equal(a.fileBase, 'X');
  assert.equal(b.fileBase, 'X (1)');
  a.release();
  a.release(); // idempotente
  assert.equal(reserveFileBase('/m', 'X', 'mp3', () => false, taken).fileBase, 'X');
});

test('seguridad: no reutiliza el nombre de archivos que yt-dlp consumiría (audio original, miniatura, parciales)', () => {
  // Un `Tema.m4a` o `Tema.jpg` de la persona sería tomado por yt-dlp como «ya descargado» y borrado al convertir.
  for (const sibling of ['A - B.m4a', 'A - B.webm', 'A - B.opus', 'A - B.jpg', 'A - B.webp', 'A - B.mp4', 'A - B.part']) {
    const existing = new Set([path.join('/m', sibling)]);
    const r = reserveFileBase('/m', 'A - B', 'mp3', (p) => existing.has(p), new Set());
    assert.equal(r.fileBase, 'A - B (1)', sibling);
  }
  // y sigue comprobando el resultado final y el siguiente número libre
  const existing = new Set([path.join('/m', 'A - B.m4a'), path.join('/m', 'A - B (1).jpg')]);
  assert.equal(reserveFileBase('/m', 'A - B', 'mp3', (p) => existing.has(p), new Set()).fileBase, 'A - B (2)');
});

test('seguridad: dos formatos simultáneos con el mismo nombre no comparten nombre base', () => {
  const taken = new Set<string>();
  const mp3 = reserveFileBase('/m', 'X - Y', 'mp3', () => false, taken);
  const m4a = reserveFileBase('/m', 'X - Y', 'm4a', () => false, taken);
  assert.equal(mp3.fileBase, 'X - Y');
  assert.equal(m4a.fileBase, 'X - Y (1)');
});

test('con el disco real: un .m4a ajeno hace que el MP3 nuevo se llame "(1)" y el original quede intacto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-name-'));
  try {
    fs.writeFileSync(path.join(dir, 'Tema.m4a'), 'de la persona');
    fs.writeFileSync(path.join(dir, 'Otro.JPG'), 'portada');
    assert.equal(reserveFileBase(dir, 'Tema', 'mp3', fs.existsSync, new Set()).fileBase, 'Tema (1)');
    assert.equal(reserveFileBase(dir, 'Otro', 'mp3', fs.existsSync, new Set()).fileBase, process.platform === 'linux' ? 'Otro' : 'Otro (1)');
    assert.equal(fs.readFileSync(path.join(dir, 'Tema.m4a'), 'utf8'), 'de la persona');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('con el disco real: nunca devuelve un archivo existente', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunedrop-name-'));
  try {
    fs.writeFileSync(path.join(dir, 'Tema.mp3'), 'x');
    const r = reserveFileBase(dir, 'Tema', 'mp3', fs.existsSync, new Set());
    assert.equal(r.fileBase, 'Tema (1)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
