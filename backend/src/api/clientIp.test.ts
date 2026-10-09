import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIp, rateLimitKey } from './clientIp';

const req = (header: string | string[] | undefined, ip = '127.0.0.1') => ({
  headers: header === undefined ? {} : { 'cf-connecting-ip': header },
  ip,
});

test('usa CF-Connecting-IP cuando es una IP válida (v4 y v6)', () => {
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9');
  assert.equal(clientIp(req(' 203.0.113.9 ')), '203.0.113.9');
  assert.equal(clientIp(req('2001:DB8::1')), '2001:db8::1');
});

test('rateLimitKey: todo un /64 IPv6 cuenta como un solo cliente (no se evade rotando de dirección)', () => {
  const a = rateLimitKey('2001:db8:aaaa:bbbb::1');
  assert.equal(a, '2001:0db8:aaaa:bbbb::/64');
  assert.equal(rateLimitKey('2001:DB8:AAAA:BBBB:1:2:3:4'), a);
  assert.equal(rateLimitKey('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff'), a);
  assert.notEqual(rateLimitKey('2001:db8:aaaa:bbbc::1'), a); // otro /64 es otro cliente
});

test('rateLimitKey: IPv4 mapeada en IPv6 cuenta igual que la IPv4; IPv4 y basura no cambian', () => {
  assert.equal(rateLimitKey('::ffff:203.0.113.99'), '203.0.113.99');
  assert.equal(rateLimitKey('::FFFF:cb00:7163'), '203.0.113.99');
  assert.equal(rateLimitKey('203.0.113.99'), '203.0.113.99');
  assert.equal(rateLimitKey('::1'), '0000:0000:0000:0000::/64');
  assert.equal(rateLimitKey('fe80::1%eth0'), 'fe80::1%eth0');
  assert.equal(rateLimitKey('no-es-ip'), 'no-es-ip');
});

test('sin cabecera usa la IP de la conexión', () => {
  assert.equal(clientIp(req(undefined, '10.0.0.5')), '10.0.0.5');
});

test('cabecera basura, vacía, lista u oversized -> IP de la conexión', () => {
  for (const bad of ['', '   ', 'not-an-ip', '1.2.3.4, 5.6.7.8', '999.1.1.1', '1.2.3.4\nx', 'a'.repeat(5000), '1'.repeat(46), ['1.2.3.4', '5.6.7.8']]) {
    assert.equal(clientIp(req(bad, '10.0.0.5')), '10.0.0.5', JSON.stringify(bad).slice(0, 40));
  }
});
