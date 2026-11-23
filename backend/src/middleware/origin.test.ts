import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { enforceTrustedOrigin } from './origin';

const app = new Hono();
app.use(enforceTrustedOrigin('http://localhost:3001'));
app.all('*', (c) => c.text('ok'));

const request = (method: string, origin?: string) =>
  app.request('/test', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : '{}',
  });

test('rejects unsafe requests from another origin regardless of content type', async () => {
  expect((await request('POST', 'http://evil.example')).status).toBe(403);
  expect((await request('PATCH', 'http://evil.example')).status).toBe(403);
  expect((await request('DELETE', 'http://evil.example')).status).toBe(403);
});

test('allows unsafe requests from the configured origin', async () => {
  expect((await request('POST', 'http://localhost:3001')).status).toBe(200);
  expect((await request('DELETE', 'http://localhost:3001')).status).toBe(200);
});

test('allows unsafe requests without an origin', async () => {
  expect((await request('POST')).status).toBe(200);
});

test('ignores safe methods', async () => {
  expect((await request('GET', 'http://evil.example')).status).toBe(200);
  expect((await request('OPTIONS', 'http://evil.example')).status).toBe(200);
});
