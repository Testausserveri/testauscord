import { expect, test } from 'bun:test';
import app from './index';

const env = { requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }) };

test('API responses are not cached', async () => {
  const unauthenticated = await app.request('/users/@me', {}, env as never);
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get('cache-control')).toBe('no-store');

  const login = await app.request('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, env as never);
  expect(login.status).toBe(400);
  expect(login.headers.get('cache-control')).toBe('no-store');
});
