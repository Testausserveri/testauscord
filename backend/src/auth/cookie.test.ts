import { expect, test } from 'bun:test';
import { createSessionTokenCookie, deleteSessionTokenCookie } from './cookie';

test('session cookie uses the __Host- prefix with Secure, HttpOnly and Path=/', () => {
  const cookie = createSessionTokenCookie('token', new Date(0));

  expect(cookie.startsWith('__Host-session=token;')).toBe(true);
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Path=/');
  expect(cookie).not.toContain('Domain=');
});

test('delete cookie matches the session cookie attributes', () => {
  const cookie = deleteSessionTokenCookie();

  expect(cookie.startsWith('__Host-session=;')).toBe(true);
  expect(cookie).toContain('Max-Age=0');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('Path=/');
  expect(cookie).not.toContain('Domain=');
});
