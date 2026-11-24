import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type AvatarRow = { data: Uint8Array; contentType: string };
type UserRow = { id: string; username: string; displayName: string | null; bio: string | null; avatarVersion: number | null; avatar: AvatarRow | null };

let users: Record<string, UserRow> = {};
let friendship: { id: string } | null = null;
let sharedServer: { id: string } | null = null;
let pendingRequest: { id: string } | null = null;
let friendships: { userAId: string; userBId: string }[] = [];

const findUser = mock(async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => {
  const user = users[where.id];
  if (!user) return null;
  if (select && 'avatar' in select) return { avatarVersion: user.avatarVersion, avatar: user.avatar };
  return { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatarVersion: user.avatarVersion };
});

const updateUser = mock(async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
  const user = users[where.id]!;
  Object.assign(user, data);
  return { id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatarVersion: user.avatarVersion };
});

const upsertAvatar = mock(async ({ where, create }: { where: { userId: string }; create: { data: Uint8Array; contentType: string } }) => {
  users[where.userId]!.avatar = { data: new Uint8Array(create.data), contentType: create.contentType };
  return null;
});

const deleteAvatar = mock(async ({ where }: { where: { userId: string } }) => {
  users[where.userId]!.avatar = null;
  return { count: 1 };
});

const prismaMock = {
  user: { findUnique: findUser, update: updateUser },
  friendship: { findUnique: mock(async () => friendship), findMany: mock(async () => friendships) },
  serverMember: { findFirst: mock(async () => sharedServer) },
  friendRequest: { findFirst: mock(async () => pendingRequest) },
  avatar: { upsert: upsertAvatar, deleteMany: deleteAvatar },
};

mock.module('../db', () => ({
  prisma: {
    ...prismaMock,
    $transaction: async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
  },
}));

const { default: usersRoute } = await import('./users');

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.set('user', { id, username: id });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/', usersRoute);

  return app;
};

const patch = (app: Hono<{ Variables: Variables }>, body: unknown) =>
  app.request('/users/@me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

const vp8x = (width: number, height: number) => {
  const w = width - 1;
  const h = height - 1;
  return new Uint8Array([
    ...ascii('RIFF'),
    0,
    0,
    0,
    0,
    ...ascii('WEBP'),
    ...ascii('VP8X'),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]);
};

const dataUrl = (image: Uint8Array, declared = 'webp') => `data:image/${declared};base64,${Buffer.from(image).toString('base64')}`;

const avatarUser = (id: string): UserRow => ({ id, username: id, displayName: null, bio: null, avatarVersion: null, avatar: null });

const captureUserUpdates = () => {
  const events: Extract<DomainEvent, { type: 'USER_UPDATED' }>[] = [];
  const stop = eventBus.subscribe((event) => {
    if (event.type === 'USER_UPDATED') events.push(event);
  });

  return { events, stop };
};

beforeEach(() => {
  users = {
    writer: avatarUser('writer'),
    friend: avatarUser('friend'),
    stranger: avatarUser('stranger'),
    'avatar-throttle': avatarUser('avatar-throttle'),
  };
  friendship = null;
  sharedServer = null;
  pendingRequest = null;
  friendships = [];
});

afterAll(() => mock.restore());

test('saves a WebP avatar and returns the new version', async () => {
  const app = createApp('writer');
  const { events, stop } = captureUserUpdates();

  try {
    const response = await patch(app, { avatar: dataUrl(vp8x(256, 256)) });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { avatarVersion: number };
    expect(body.avatarVersion).toBeGreaterThan(0);
    expect(users.writer!.avatar?.contentType).toBe('image/webp');
    expect(events).toHaveLength(1);
    expect(events[0]!.user.avatarVersion).toBe(body.avatarVersion);
    expect(events[0]!.recipientIds).toEqual(['writer']);
  } finally {
    stop();
  }
});

test('derives the stored content type from magic bytes', async () => {
  const app = createApp('writer');

  const response = await patch(app, { avatar: dataUrl(vp8x(256, 256), 'jpeg') });

  expect(response.status).toBe(200);
  expect(users.writer!.avatar?.contentType).toBe('image/webp');
});

test('clears the avatar with null', async () => {
  users.writer = { ...users.writer!, avatarVersion: 42, avatar: { data: vp8x(256, 256), contentType: 'image/webp' } };
  const app = createApp('writer');

  const response = await patch(app, { avatar: null });

  expect(response.status).toBe(200);
  expect(((await response.json()) as { avatarVersion: number | null }).avatarVersion).toBeNull();
  expect(users.writer!.avatar).toBeNull();
});

test('rejects invalid avatars', async () => {
  const app = createApp('writer');
  const oversized = new Uint8Array(129 * 1024);
  oversized.set(vp8x(256, 256));

  const bodies = [
    { avatar: 'data:image/png;base64,iVBORw0KGgo=' },
    { avatar: 'data:image/webp;base64,***' },
    { avatar: dataUrl(vp8x(256, 256), 'png') },
    { avatar: dataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) },
    { avatar: dataUrl(vp8x(2048, 256)) },
    { avatar: dataUrl(vp8x(256, 2048)) },
    { avatar: dataUrl(oversized) },
    { avatar: 5 },
  ];

  for (const body of bodies) {
    const response = await patch(app, body);
    expect(response.status).toBe(400);
  }
});

test('serves the avatar with private immutable caching', async () => {
  users.friend = { ...users.friend!, avatarVersion: 42, avatar: { data: vp8x(256, 256), contentType: 'image/webp' } };
  friendship = { id: 'friendship-1' };

  const response = await createApp('writer').request('/users/friend/avatar');

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-site');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('etag')).toBe('"v42"');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(vp8x(256, 256));
});

test('returns 304 for a matching ETag', async () => {
  users.friend = { ...users.friend!, avatarVersion: 42, avatar: { data: vp8x(256, 256), contentType: 'image/webp' } };
  friendship = { id: 'friendship-1' };

  const response = await createApp('writer').request('/users/friend/avatar', { headers: { 'if-none-match': '"v42"' } });

  expect(response.status).toBe(304);
  expect(await response.text()).toBe('');
});

test('hides avatars from unrelated users and for missing avatars', async () => {
  users.stranger = { ...users.stranger!, avatarVersion: 7, avatar: { data: vp8x(256, 256), contentType: 'image/webp' } };
  const app = createApp('writer');

  const unrelated = await app.request('/users/stranger/avatar');
  const missingAvatar = await app.request('/users/friend/avatar');
  const missingUser = await app.request('/users/missing/avatar');

  expect(unrelated.status).toBe(404);
  expect(missingAvatar.status).toBe(404);
  expect(missingUser.status).toBe(404);
});

test('requires authentication', async () => {
  const unauthenticated = new Hono<{ Variables: Variables }>();
  unauthenticated.route('/', usersRoute);

  expect((await unauthenticated.request('/users/friend/avatar')).status).toBe(401);
});

test('throttles avatar requests per viewer after 300 requests', async () => {
  users['avatar-throttle'] = { ...users['avatar-throttle']!, avatarVersion: 1, avatar: { data: vp8x(256, 256), contentType: 'image/webp' } };
  const app = createApp('avatar-throttle');
  const statuses: number[] = [];

  for (let index = 0; index < 301; index++) {
    const response = await app.request('/users/avatar-throttle/avatar');
    statuses.push(response.status);
  }

  expect(statuses.slice(0, 300)).toEqual(Array.from({ length: 300 }, () => 200));
  expect(statuses[300]).toBe(429);
});
