import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type Row = { id: string; username: string; displayName: string | null; bio: string | null };

let users: Record<string, Row> = {};
let friendship: { id: string } | null = null;
let sharedServer: { id: string } | null = null;
let pendingRequest: { id: string } | null = null;

const findUser = mock(async ({ where }: { where: { id: string } }) => users[where.id] ?? null);
const findFriendship = mock(async () => friendship);
const findServerMember = mock(async () => sharedServer);
const findFriendRequest = mock(async () => pendingRequest);

mock.module('../db', () => ({
  prisma: {
    user: { findUnique: findUser },
    friendship: { findUnique: findFriendship },
    serverMember: { findFirst: findServerMember },
    friendRequest: { findFirst: findFriendRequest },
  },
}));

const { default: usersRoute } = await import('./users');

const createApp = (id: string, sessionId: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'viewer' });
    c.set('session', { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/', usersRoute);

  return app;
};

const app = createApp('viewer', 'session-viewer');
const throttleApp = createApp('user-throttle', 'session-throttle');

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/', usersRoute);

const profile = (id: string): Row => ({
  id,
  username: id,
  displayName: id === 'viewer' ? 'Viewer' : null,
  bio: id === 'viewer' ? 'hello' : null,
});

beforeEach(() => {
  users = {
    viewer: profile('viewer'),
    friend: profile('friend'),
    stranger: profile('stranger'),
    'user-throttle': profile('user-throttle'),
  };
  friendship = null;
  sharedServer = null;
  pendingRequest = null;
});

afterAll(() => mock.restore());

test('returns the full profile for the current user', async () => {
  const response = await app.request('/users/@me');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'viewer', username: 'viewer', displayName: 'Viewer', bio: 'hello' });
});

test('returns a friend profile', async () => {
  friendship = { id: 'friendship-1' };

  const response = await app.request('/users/friend');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'friend', username: 'friend', displayName: null, bio: null });
});

test('returns a profile for a pending request', async () => {
  pendingRequest = { id: 'request-1' };

  const response = await app.request('/users/stranger');

  expect(response.status).toBe(200);
  expect(((await response.json()) as { id: string }).id).toBe('stranger');
});

test('hides unrelated and missing users with the same response', async () => {
  const unrelated = await app.request('/users/stranger');
  const missing = await app.request('/users/missing');

  expect(unrelated.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(await unrelated.text()).toBe('User not found');
  expect(await missing.text()).toBe('User not found');
});

test('requires authentication', async () => {
  const response = await unauthenticated.request('/users/@me');

  expect(response.status).toBe(401);
});

test('throttles profile lookups per user after 60 requests', async () => {
  const statuses: number[] = [];
  let last: Response | undefined;

  for (let index = 0; index < 61; index++) {
    last = await throttleApp.request('/users/@me');
    statuses.push(last.status);
  }

  expect(statuses.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => 200));
  expect(statuses[60]).toBe(429);
  expect(last!.headers.get('retry-after')).toBeTruthy();
});
