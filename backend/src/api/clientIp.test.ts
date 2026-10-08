import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIp } from './clientIp';

const req = (header: string | string[] | undefined, ip = '127.0.0.1') => ({
  headers: header === undefined ? {} : { 'cf-connecting-ip': header },
  ip,
});

test('usa CF-Connecting-IP cuando es una IP válida (v4 y v6)', () => {
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9');
  assert.equal(clientIp(req(' 203.0.113.9 ')), '203.0.113.9');
  assert.equal(clientIp(req('2001:DB8::1')), '2001:db8::1');
});

test('sin cabecera usa la IP de la conexión', () => {
  assert.equal(clientIp(req(undefined, '10.0.0.5')), '10.0.0.5');
});

test('cabecera basura, vacía, lista u oversized -> IP de la conexión', () => {
  for (const bad of ['', '   ', 'not-an-ip', '1.2.3.4, 5.6.7.8', '999.1.1.1', '1.2.3.4\nx', 'a'.repeat(5000), '1'.repeat(46), ['1.2.3.4', '5.6.7.8']]) {
    assert.equal(clientIp(req(bad, '10.0.0.5')), '10.0.0.5', JSON.stringify(bad).slice(0, 40));
  }
});
