import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import sharp from 'sharp';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type AvatarRow = { data: Uint8Array; contentType: string; posterData?: Uint8Array | null; posterContentType?: string | null };
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

const upsertAvatar = mock(
  async ({ where, create }: { where: { userId: string }; create: { data: Uint8Array; contentType: string; posterData: Uint8Array | null; posterContentType: string | null } }) => {
    users[where.userId]!.avatar = {
      data: new Uint8Array(create.data),
      contentType: create.contentType,
      posterData: create.posterData ? new Uint8Array(create.posterData) : null,
      posterContentType: create.posterContentType,
    };
    return null;
  },
);

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

const avatarWebp = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const wideAvatarWebp = await sharp({ create: { width: 2048, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const tallAvatarWebp = await sharp({ create: { width: 256, height: 2048, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const largePosterWebp = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const posterGif = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .gif()
  .toBuffer();

const animatedGif = async (width: number, height: number, frames: number) => {
  const images = await Promise.all(
    Array.from({ length: frames }, (_, index) =>
      sharp({ create: { width, height, channels: 4, background: index % 2 === 0 ? { r: 255, g: 0, b: 0, alpha: 1 } : { r: 0, g: 0, b: 255, alpha: 1 } } })
        .png()
        .toBuffer(),
    ),
  );

  return sharp(images, { join: { animated: true } })
    .gif()
    .toBuffer();
};

const animatedAvatarGif = await animatedGif(128, 128, 3);
const wideAnimatedGif = await animatedGif(257, 128, 2);

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
    const response = await patch(app, { avatar: dataUrl(avatarWebp) });

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

  const response = await patch(app, { avatar: dataUrl(avatarWebp, 'jpeg') });

  expect(response.status).toBe(200);
  expect(users.writer!.avatar?.contentType).toBe('image/webp');
});

test('saves an animated avatar with its poster', async () => {
  const app = createApp('writer');

  const response = await patch(app, { avatar: dataUrl(animatedAvatarGif, 'gif'), avatarPoster: dataUrl(avatarWebp) });

  expect(response.status).toBe(200);
  expect(users.writer!.avatar?.contentType).toBe('image/gif');
  expect(users.writer!.avatar?.posterContentType).toBe('image/webp');
  expect(users.writer!.avatar?.posterData).toEqual(new Uint8Array(avatarWebp));
});

test('requires a poster for animated avatars', async () => {
  const app = createApp('writer');

  const response = await patch(app, { avatar: dataUrl(animatedAvatarGif, 'gif') });

  expect(response.status).toBe(400);
  expect(users.writer!.avatar).toBeNull();
});

test('ignores the poster for static avatars and clears an old one', async () => {
  users.writer = {
    ...users.writer!,
    avatarVersion: 42,
    avatar: { data: animatedAvatarGif, contentType: 'image/gif', posterData: avatarWebp, posterContentType: 'image/webp' },
  };
  const app = createApp('writer');

  const response = await patch(app, { avatar: dataUrl(avatarWebp), avatarPoster: dataUrl(avatarWebp) });

  expect(response.status).toBe(200);
  expect(users.writer!.avatar?.contentType).toBe('image/webp');
  expect(users.writer!.avatar?.posterData).toBeNull();
  expect(users.writer!.avatar?.posterContentType).toBeNull();
});

test('rejects invalid avatar posters', async () => {
  const app = createApp('writer');

  const bodies = [
    { avatarPoster: dataUrl(avatarWebp) },
    { avatar: null, avatarPoster: dataUrl(avatarWebp) },
    { avatar: dataUrl(animatedAvatarGif, 'gif'), avatarPoster: dataUrl(posterGif, 'gif') },
    { avatar: dataUrl(animatedAvatarGif, 'gif'), avatarPoster: dataUrl(largePosterWebp) },
    { avatar: dataUrl(animatedAvatarGif, 'gif'), avatarPoster: 'not a data url' },
    { avatar: dataUrl(wideAnimatedGif, 'gif'), avatarPoster: dataUrl(avatarWebp) },
  ];

  for (const body of bodies) {
    const response = await patch(app, body);
    expect(response.status).toBe(400);
  }
});

test('serves the poster with static=1', async () => {
  users.friend = {
    ...users.friend!,
    avatarVersion: 42,
    avatar: { data: animatedAvatarGif, contentType: 'image/gif', posterData: avatarWebp, posterContentType: 'image/webp' },
  };
  friendship = { id: 'friendship-1' };

  const animated = await createApp('writer').request('/users/friend/avatar');
  const still = await createApp('writer').request('/users/friend/avatar?static=1');

  expect(animated.status).toBe(200);
  expect(animated.headers.get('content-type')).toBe('image/gif');
  expect(animated.headers.get('etag')).toBe('"v42"');
  expect(still.status).toBe(200);
  expect(still.headers.get('content-type')).toBe('image/webp');
  expect(still.headers.get('etag')).toBe('"v42-static"');
  expect(new Uint8Array(await still.arrayBuffer())).toEqual(avatarWebp);
});

test('falls back to the main image with static=1 for static avatars', async () => {
  users.friend = { ...users.friend!, avatarVersion: 42, avatar: { data: avatarWebp, contentType: 'image/webp', posterData: null, posterContentType: null } };
  friendship = { id: 'friendship-1' };

  const response = await createApp('writer').request('/users/friend/avatar?static=1');

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(avatarWebp);
});

test('clears the avatar with null', async () => {
  users.writer = { ...users.writer!, avatarVersion: 42, avatar: { data: avatarWebp, contentType: 'image/webp' } };
  const app = createApp('writer');

  const response = await patch(app, { avatar: null });

  expect(response.status).toBe(200);
  expect(((await response.json()) as { avatarVersion: number | null }).avatarVersion).toBeNull();
  expect(users.writer!.avatar).toBeNull();
});

test('rejects invalid avatars', async () => {
  const app = createApp('writer');
  const oversized = new Uint8Array(129 * 1024);
  oversized.set(avatarWebp);

  const bodies = [
    { avatar: 'data:image/png;base64,iVBORw0KGgo=' },
    { avatar: 'data:image/webp;base64,***' },
    { avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' },
    { avatar: dataUrl(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) },
    { avatar: dataUrl(wideAvatarWebp) },
    { avatar: dataUrl(tallAvatarWebp) },
    { avatar: dataUrl(oversized) },
    { avatar: 5 },
  ];

  for (const body of bodies) {
    const response = await patch(app, body);
    expect(response.status).toBe(400);
  }
});

test('serves the avatar with private immutable caching', async () => {
  users.friend = { ...users.friend!, avatarVersion: 42, avatar: { data: avatarWebp, contentType: 'image/webp' } };
  friendship = { id: 'friendship-1' };

  const response = await createApp('writer').request('/users/friend/avatar');

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-site');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('etag')).toBe('"v42"');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(avatarWebp);
});

test('returns 304 for a matching ETag', async () => {
  users.friend = { ...users.friend!, avatarVersion: 42, avatar: { data: avatarWebp, contentType: 'image/webp' } };
  friendship = { id: 'friendship-1' };

  const response = await createApp('writer').request('/users/friend/avatar', { headers: { 'if-none-match': '"v42"' } });

  expect(response.status).toBe(304);
  expect(await response.text()).toBe('');
});

test('hides avatars from unrelated users and for missing avatars', async () => {
  users.stranger = { ...users.stranger!, avatarVersion: 7, avatar: { data: avatarWebp, contentType: 'image/webp' } };
  const app = createApp('writer');

  const unrelated = await app.request('/users/stranger/avatar');
  const unrelatedStatic = await app.request('/users/stranger/avatar?static=1');
  const missingAvatar = await app.request('/users/friend/avatar');
  const missingUser = await app.request('/users/missing/avatar');

  expect(unrelated.status).toBe(404);
  expect(unrelatedStatic.status).toBe(404);
  expect(missingAvatar.status).toBe(404);
  expect(missingUser.status).toBe(404);
});

test('requires authentication', async () => {
  const unauthenticated = new Hono<{ Variables: Variables }>();
  unauthenticated.route('/', usersRoute);

  expect((await unauthenticated.request('/users/friend/avatar')).status).toBe(401);
});

test('throttles avatar requests per viewer after 300 requests', async () => {
  users['avatar-throttle'] = { ...users['avatar-throttle']!, avatarVersion: 1, avatar: { data: avatarWebp, contentType: 'image/webp' } };
  const app = createApp('avatar-throttle');
  const statuses: number[] = [];

  for (let index = 0; index < 301; index++) {
    const response = await app.request('/users/avatar-throttle/avatar');
    statuses.push(response.status);
  }

  expect(statuses.slice(0, 300)).toEqual(Array.from({ length: 300 }, () => 200));
  expect(statuses[300]).toBe(429);
});
