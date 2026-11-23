import { expect, test } from 'bun:test';
import app from '../index';

const env = { requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }) };

const post = (path: string, body: string) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, env as never);

test('malformed JSON returns 400 on login and signup', async () => {
  for (const path of ['/login', '/signup']) {
    const response = await post(path, '{');
    expect(response.status).toBe(400);
  }
});

test('missing password returns 400 on login and signup', async () => {
  for (const path of ['/login', '/signup']) {
    const response = await post(path, JSON.stringify({ username: 'alice' }));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid password');
  }
});
