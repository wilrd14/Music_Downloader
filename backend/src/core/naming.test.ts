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
