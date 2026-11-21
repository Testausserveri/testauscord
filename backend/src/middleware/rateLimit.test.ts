import { expect, test } from 'bun:test';
import { parseTrustedProxies, resolveClientIp } from './rateLimit';

const trusted = parseTrustedProxies('10.0.0.1, ::1');

test('parses a comma separated trusted proxy list', () => {
  expect([...parseTrustedProxies(' 10.0.0.1 , ::1, ')]).toEqual(['10.0.0.1', '::1']);
});

test('ignores forwarded headers from untrusted peers', () => {
  expect(resolveClientIp('203.0.113.5', '198.51.100.7', trusted)).toBe('203.0.113.5');
});

test('uses the rightmost untrusted hop behind a trusted proxy', () => {
  expect(resolveClientIp('10.0.0.1', '198.51.100.7', trusted)).toBe('198.51.100.7');
  expect(resolveClientIp('10.0.0.1', '1.2.3.4, 198.51.100.7', trusted)).toBe('198.51.100.7');
  expect(resolveClientIp('10.0.0.1', '198.51.100.7, 10.0.0.1', trusted)).toBe('198.51.100.7');
});

test('falls back to the peer when every hop is trusted', () => {
  expect(resolveClientIp('::1', '10.0.0.1', trusted)).toBe('::1');
  expect(resolveClientIp('::1', undefined, trusted)).toBe('::1');
});

test('normalizes IPv4-mapped IPv6 peers and trusted entries', () => {
  const loopback = parseTrustedProxies('127.0.0.1, ::1');

  expect(resolveClientIp('::ffff:127.0.0.1', '198.51.100.7', loopback)).toBe('198.51.100.7');
  expect(resolveClientIp('::1', '198.51.100.7', loopback)).toBe('198.51.100.7');
  expect(resolveClientIp('::ffff:203.0.113.5', '198.51.100.7', loopback)).toBe('203.0.113.5');
});
