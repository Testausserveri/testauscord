import { expect, test } from 'bun:test';
import app, { MAX_REQUEST_BODY_BYTES, MAX_UPLOAD_BODY_BYTES } from './index';

const env = { requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }) };

test('API responses are not cached', async () => {
  const unauthenticated = await app.request('/users/@me', {}, env as never);
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get('cache-control')).toBe('no-store');

  const login = await app.request('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, env as never);
  expect(login.status).toBe(400);
  expect(login.headers.get('cache-control')).toBe('no-store');
});

test('applies body limits per route', async () => {
  const server = Bun.serve({ port: 0, maxRequestBodySize: MAX_REQUEST_BODY_BYTES, fetch: app.fetch });

  try {
    const url = `http://localhost:${server.port}`;
    const send = (method: string, path: string, size: number) => fetch(`${url}${path}`, { method, headers: { 'content-type': 'application/json' }, body: 'x'.repeat(size) });

    expect((await send('POST', '/login', 300 * 1024)).status).toBe(413);
    expect((await send('PATCH', '/users/@me', MAX_UPLOAD_BODY_BYTES + 1)).status).toBe(413);
    expect((await send('PATCH', '/users/@me', 400 * 1024)).status).toBe(401);
  } finally {
    server.stop(true);
  }
});
