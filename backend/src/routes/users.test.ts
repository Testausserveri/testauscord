import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type Row = { id: string; username: string; displayName: string | null; bio: string | null };

let users: Record<string, Row> = {};
let friendship: { id: string } | null = null;
let sharedServer: { id: string } | null = null;
let pendingRequest: { id: string } | null = null;
let takenUsername: string | null = null;

const findUser = mock(async ({ where }: { where: { id: string } }) => users[where.id] ?? null);
const findFriendship = mock(async () => friendship);
const findServerMember = mock(async () => sharedServer);
const findFriendRequest = mock(async () => pendingRequest);
const updateUser = mock(async ({ where, data }: { where: { id: string }; data: Partial<Pick<Row, 'username' | 'displayName' | 'bio'>> }) => {
  if (takenUsername !== null && data.username === takenUsername) {
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }

  const user = users[where.id]!;
  Object.assign(user, data);
  return { ...user };
});

mock.module('../db', () => ({
  prisma: {
    user: { findUnique: findUser, update: updateUser },
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
const writerApp = createApp('writer', 'session-writer');
const validationApp = createApp('user-validation', 'session-validation');
const writeThrottleApp = createApp('user-write-throttle', 'session-write-throttle');
const nameThrottleApp = createApp('user-name-throttle', 'session-name-throttle');

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/', usersRoute);

const patchProfile = (target: Hono<{ Variables: Variables }>, body: unknown) =>
  target.request('/users/@me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

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
    writer: profile('writer'),
    'user-validation': profile('user-validation'),
    'user-write-throttle': profile('user-write-throttle'),
    'user-name-throttle': profile('user-name-throttle'),
  };
  friendship = null;
  sharedServer = null;
  pendingRequest = null;
  takenUsername = null;
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

test('updates and normalizes display name and bio', async () => {
  const response = await patchProfile(writerApp, { displayName: '  Alice  ', bio: 'hello\r\nworld  \r\n' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'writer', username: 'writer', displayName: 'Alice', bio: 'hello\nworld' });
});

test('clears display name and bio when empty', async () => {
  users.writer = { ...users.writer!, displayName: 'Alice', bio: 'hello' };

  const response = await patchProfile(writerApp, { displayName: '   ', bio: '' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'writer', username: 'writer', displayName: null, bio: null });
});

test('changes the username and keeps the same name a no-op', async () => {
  const changed = await patchProfile(writerApp, { username: 'new_name' });
  expect(changed.status).toBe(200);
  expect(((await changed.json()) as Row).username).toBe('new_name');

  const same = await patchProfile(writerApp, { username: 'new_name' });
  expect(same.status).toBe(200);
});

test('rejects invalid profile fields', async () => {
  const bodies = [
    { username: 'ab' },
    { username: 'UPPER' },
    { username: 'a'.repeat(32) },
    { username: 5 },
    { displayName: 'a'.repeat(33) },
    { displayName: 'bad\u0007' },
    { displayName: 'bad\u202E' },
    { bio: 'a'.repeat(191) },
    { bio: 'bad\u0000' },
    { bio: 'bad\u0007' },
    { bio: 'bad\u202E' },
    {},
    { nickname: 'x' },
  ];

  for (const body of bodies) {
    const response = await patchProfile(validationApp, body);
    expect(response.status).toBe(400);
  }
});

test('returns 409 when the username is taken', async () => {
  takenUsername = 'taken';

  const response = await patchProfile(writerApp, { username: 'taken' });

  expect(response.status).toBe(409);
  expect(await response.text()).toBe('Username already in use');
});

test('throttles profile writes per user after 30 requests', async () => {
  const statuses: number[] = [];
  let last: Response | undefined;

  for (let index = 0; index < 31; index++) {
    last = await patchProfile(writeThrottleApp, { bio: 'hello' });
    statuses.push(last.status);
  }

  expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 200));
  expect(statuses[30]).toBe(429);
  expect(last!.headers.get('retry-after')).toBeTruthy();
});

test('throttles username changes separately from other writes', async () => {
  const statuses: number[] = [];

  for (let index = 0; index < 11; index++) {
    const response = await patchProfile(nameThrottleApp, { username: 'name-throttle' });
    statuses.push(response.status);
  }

  expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 200));
  expect(statuses[10]).toBe(429);

  const bio = await patchProfile(nameThrottleApp, { bio: 'still allowed' });
  expect(bio.status).toBe(200);
});
