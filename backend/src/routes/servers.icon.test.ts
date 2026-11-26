import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import sharp from 'sharp';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type IconRow = { data: Uint8Array; contentType: string; posterData?: Uint8Array | null; posterContentType?: string | null };
type ServerRow = {
  id: string;
  name: string;
  ownerId: string;
  iconVersion: number | null;
  icon: IconRow | null;
  members: { userId: string }[];
  bans: { userId: string }[];
};

let servers: ServerRow[] = [];

const findFirst = mock(async ({ where, select }: { where: { id: string; members?: { some: { userId: string } }; bans?: { none: { userId: string } } }; select?: Record<string, unknown> }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server) return null;

  const memberId = where.members?.some.userId;
  if (memberId !== undefined && !server.members.some((member) => member.userId === memberId)) return null;

  const bannedId = where.bans?.none.userId;
  if (bannedId !== undefined && server.bans.some((ban) => ban.userId === bannedId)) return null;

  if (select && 'icon' in select) return { iconVersion: server.iconVersion, icon: server.icon };
  return { id: server.id, name: server.name, ownerId: server.ownerId, iconVersion: server.iconVersion };
});

const updateServer = mock(async ({ where, data }: { where: { id: string }; data: { name?: string; iconVersion?: number | null } }) => {
  const server = servers.find((entry) => entry.id === where.id)!;
  if (data.name !== undefined) server.name = data.name;
  if ('iconVersion' in data) server.iconVersion = data.iconVersion ?? null;

  return { id: server.id, name: server.name, iconVersion: server.iconVersion };
});

const upsertIcon = mock(
  async ({ where, create }: { where: { serverId: string }; create: { data: Uint8Array; contentType: string; posterData: Uint8Array | null; posterContentType: string | null } }) => {
    const server = servers.find((entry) => entry.id === where.serverId)!;
    server.icon = {
      data: new Uint8Array(create.data),
      contentType: create.contentType,
      posterData: create.posterData ? new Uint8Array(create.posterData) : null,
      posterContentType: create.posterContentType,
    };
    return null;
  },
);

const deleteIcons = mock(async ({ where }: { where: { serverId: string } }) => {
  const server = servers.find((entry) => entry.id === where.serverId)!;
  server.icon = null;
  return { count: 1 };
});

const findMembers = mock(async ({ where }: { where: { serverId: string } }) => servers.find((entry) => entry.id === where.serverId)?.members ?? []);

const prismaMock = {
  server: { findFirst, update: updateServer },
  serverIcon: { upsert: upsertIcon, deleteMany: deleteIcons },
  serverMember: { findMany: findMembers },
};

mock.module('../db', () => ({
  prisma: {
    ...prismaMock,
    $transaction: async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
  },
}));

const { default: serversRoute } = await import('./servers');

const owner = 'icon-owner';
const member = 'icon-member';
const outsider = 'icon-outsider';
const banned = 'icon-banned';
const validator = 'icon-validator';
const throttled = 'icon-throttled';

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'alice' });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/servers', serversRoute);

  return app;
};

const app = createApp(owner);
const memberApp = createApp(member);
const outsiderApp = createApp(outsider);
const bannedApp = createApp(banned);
const validationApp = createApp(validator);
const throttledApp = createApp(throttled);

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/servers', serversRoute);

const patch = (target: Hono<{ Variables: Variables }>, id: string, body: unknown) =>
  target.request(`/servers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const iconWebp = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const wideIconWebp = await sharp({ create: { width: 2048, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const largePosterWebp = await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
  .webp()
  .toBuffer();
const staticPng = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } })
  .png()
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

const animatedIconGif = await animatedGif(128, 128, 3);

const dataUrl = (image: Uint8Array, declared = 'webp') => `data:image/${declared};base64,${Buffer.from(image).toString('base64')}`;

const captureServerUpdates = () => {
  const updates: Extract<DomainEvent, { type: 'SERVER_UPDATED' }>[] = [];
  const stop = eventBus.subscribe((event) => {
    if (event.type === 'SERVER_UPDATED') updates.push(event);
  });

  return { updates, stop };
};

beforeEach(() => {
  servers = [
    {
      id: 'server-1',
      name: 'Testaus',
      ownerId: owner,
      iconVersion: null,
      icon: null,
      members: [{ userId: owner }, { userId: member }],
      bans: [{ userId: banned }],
    },
    {
      id: 'server-validator',
      name: 'Validation',
      ownerId: validator,
      iconVersion: null,
      icon: null,
      members: [{ userId: validator }],
      bans: [],
    },
  ];
});

afterAll(() => mock.restore());

test('stores a static icon and returns the new version', async () => {
  const { updates, stop } = captureServerUpdates();

  try {
    const response = await patch(app, 'server-1', { icon: dataUrl(iconWebp) });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { iconVersion: number };
    expect(body.iconVersion).toBeGreaterThan(0);
    expect(servers[0]!.icon?.contentType).toBe('image/webp');
    expect(updates).toEqual([{ type: 'SERVER_UPDATED', server: { id: 'server-1', name: 'Testaus' }, recipientIds: [owner, member] }]);
  } finally {
    stop();
  }
});

test('stores an animated icon with its poster and serves the poster with static=1', async () => {
  const response = await patch(app, 'server-1', { icon: dataUrl(animatedIconGif, 'gif'), iconPoster: dataUrl(iconWebp) });

  expect(response.status).toBe(200);

  const body = (await response.json()) as { iconVersion: number };
  expect(servers[0]!.icon?.contentType).toBe('image/gif');
  expect(servers[0]!.icon?.posterContentType).toBe('image/webp');

  const animated = await memberApp.request('/servers/server-1/icon');
  const still = await memberApp.request('/servers/server-1/icon?static=1');

  expect(animated.status).toBe(200);
  expect(animated.headers.get('content-type')).toBe('image/gif');
  expect(animated.headers.get('etag')).toBe(`"v${body.iconVersion}"`);
  expect(still.status).toBe(200);
  expect(still.headers.get('content-type')).toBe('image/webp');
  expect(still.headers.get('etag')).toBe(`"v${body.iconVersion}-static"`);
  expect(new Uint8Array(await still.arrayBuffer())).toEqual(new Uint8Array(iconWebp));
});

test('requires a poster for animated icons', async () => {
  const response = await patch(app, 'server-1', { icon: dataUrl(animatedIconGif, 'gif') });

  expect(response.status).toBe(400);
  expect(servers[0]!.icon).toBeNull();
});

test('rejects invalid icons and posters', async () => {
  const oversized = new Uint8Array(129 * 1024);
  oversized.set(iconWebp);

  const bodies = [
    {},
    { iconPoster: dataUrl(iconWebp) },
    { icon: null, iconPoster: dataUrl(iconWebp) },
    { icon: 'not a data url' },
    { icon: dataUrl(staticPng, 'png') },
    { icon: dataUrl(wideIconWebp) },
    { icon: dataUrl(oversized) },
    { icon: dataUrl(animatedIconGif, 'gif'), iconPoster: dataUrl(posterGif, 'gif') },
    { icon: dataUrl(animatedIconGif, 'gif'), iconPoster: dataUrl(largePosterWebp) },
  ];

  for (const body of bodies) {
    const response = await patch(validationApp, 'server-validator', body);
    expect(response.status).toBe(400);
  }

  expect(servers[1]!.icon).toBeNull();
});

test('removes the icon with null', async () => {
  servers[0] = { ...servers[0]!, iconVersion: 42, icon: { data: iconWebp, contentType: 'image/webp' } };

  const response = await patch(app, 'server-1', { icon: null });

  expect(response.status).toBe(200);
  expect(((await response.json()) as { iconVersion: number | null }).iconVersion).toBeNull();
  expect(servers[0]!.icon).toBeNull();
  expect(servers[0]!.iconVersion).toBeNull();
});

test('rejects a non-owner member and hides the server from outsiders', async () => {
  expect((await patch(memberApp, 'server-1', { icon: dataUrl(iconWebp) })).status).toBe(403);
  expect((await patch(outsiderApp, 'server-1', { icon: dataUrl(iconWebp) })).status).toBe(404);
  expect(servers[0]!.icon).toBeNull();
});

test('serves static icons without a poster and supports 304', async () => {
  servers[0] = { ...servers[0]!, iconVersion: 42, icon: { data: iconWebp, contentType: 'image/webp', posterData: null, posterContentType: null } };

  const response = await memberApp.request('/servers/server-1/icon?static=1');

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/webp');
  expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-site');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(iconWebp));

  const cached = await memberApp.request('/servers/server-1/icon', { headers: { 'if-none-match': '"v42"' } });
  expect(cached.status).toBe(304);
  expect(await cached.text()).toBe('');
});

test('hides the icon from outsiders, banned members and when missing', async () => {
  servers[0] = { ...servers[0]!, iconVersion: 42, icon: { data: iconWebp, contentType: 'image/webp' } };

  expect((await outsiderApp.request('/servers/server-1/icon')).status).toBe(404);
  expect((await bannedApp.request('/servers/server-1/icon')).status).toBe(404);

  servers[0]!.icon = null;
  expect((await memberApp.request('/servers/server-1/icon')).status).toBe(404);
  expect((await memberApp.request('/servers/missing/icon')).status).toBe(404);
});

test('requires authentication', async () => {
  expect((await unauthenticated.request('/servers/server-1/icon')).status).toBe(401);
  expect((await patch(unauthenticated, 'server-1', { icon: dataUrl(iconWebp) })).status).toBe(401);
});

test('throttles icon requests per viewer after 300 requests', async () => {
  servers.push({
    id: 'server-throttle',
    name: 'Throttle',
    ownerId: throttled,
    iconVersion: 1,
    icon: { data: iconWebp, contentType: 'image/webp' },
    members: [{ userId: throttled }],
    bans: [],
  });

  const statuses: number[] = [];

  for (let index = 0; index < 301; index++) {
    const response = await throttledApp.request('/servers/server-throttle/icon');
    statuses.push(response.status);
  }

  expect(statuses.slice(0, 300)).toEqual(Array.from({ length: 300 }, () => 200));
  expect(statuses[300]).toBe(429);
});
