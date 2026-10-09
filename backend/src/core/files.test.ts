import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeFileName } from './files';

test('reemplaza caracteres inválidos de Windows', () => {
  assert.equal(sanitizeFileName('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j');
});

test('elimina caracteres de control y colapsa espacios', () => {
  assert.equal(sanitizeFileName('  hola \u0000\n  mundo  '), 'hola __ mundo');
});

test('quita puntos y espacios finales', () => {
  assert.equal(sanitizeFileName('Canción...'), 'Canción');
  assert.equal(sanitizeFileName('x. . '), 'x');
});

test('vacío o solo puntos devuelve "audio"', () => {
  assert.equal(sanitizeFileName(''), 'audio');
  assert.equal(sanitizeFileName('...'), 'audio');
  assert.equal(sanitizeFileName('   '), 'audio');
});

test('no permite recorrer directorios', () => {
  const out = sanitizeFileName('../../etc/passwd');
  assert.ok(!out.includes('/') && !out.includes('\\'));
  assert.notEqual(out, '..');
});

test('respeta la longitud máxima sin dejar punto final', () => {
  const out = sanitizeFileName('a'.repeat(10) + '.' + 'b'.repeat(200), 11);
  assert.equal(out, 'a'.repeat(10));
  assert.ok(sanitizeFileName('x'.repeat(500)).length <= 120);
});

test('seguridad: quita anulaciones de dirección y caracteres invisibles (extensión disfrazada)', () => {
  // U+202E (RLO) haría que `Tema‮gpj.3pm` se vea como «Tema mp3.jpg»
  assert.equal(sanitizeFileName('Tema‮gpj'), 'Temagpj');
  assert.equal(sanitizeFileName('a⁦b⁩c​d‏e﻿f\u0085g\u007Fh'), 'abcdefgh');
  // se conservan ZWNJ/ZWJ (persa, emojis compuestos)
  assert.equal(sanitizeFileName('می‌خواهم'), 'می‌خواهم');
  const out = sanitizeFileName('‮');
  assert.equal(out, 'audio');
});

test('seguridad: también reserva COM¹/LPT² (superíndices) de Windows', () => {
  assert.equal(sanitizeFileName('COM¹'), '_COM¹');
  assert.equal(sanitizeFileName('lpt².txt'), '_lpt².txt');
  assert.equal(sanitizeFileName('com¹x'), 'com¹x');
});

test('nombres reservados de Windows se prefijan', () => {
  assert.equal(sanitizeFileName('CON'), '_CON');
  assert.equal(sanitizeFileName('nul.txt'), '_nul.txt');
  assert.equal(sanitizeFileName('console'), 'console');
});
