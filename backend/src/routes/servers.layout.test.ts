import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type ServerRow = { id: string; ownerId: string; members: string[] };
type CategoryRow = { id: string; serverId: string; name: string; position: number; createdAt: Date };
type ChannelRow = { id: string; serverId: string; name: string; type: 'TEXT'; categoryId: string | null; position: number; createdAt: Date };
type LayoutResponse = {
  categories: { id: string; name: string; position: number }[];
  channels: { id: string; name: string; type: 'TEXT'; categoryId: string | null; position: number }[];
};

let servers: ServerRow[] = [];
let categories: CategoryRow[] = [];
let channels: ChannelRow[] = [];
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;
let failChannelUpdateId: string | null = null;

const findServer = mock(async ({ where }: { where: { id: string; members: { some: { userId: string } } } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server || !server.members.includes(where.members.some.userId)) return null;
  return { id: server.id, ownerId: server.ownerId };
});

const findCategories = mock(async ({ where }: { where: { serverId: string } }) => {
  return categories
    .filter((entry) => entry.serverId === where.serverId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, position: entry.position }));
});

const findChannels = mock(async ({ where }: { where: { serverId: string } }) => {
  return channels
    .filter((entry) => entry.serverId === where.serverId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, type: entry.type, categoryId: entry.categoryId, position: entry.position }));
});

const findMembers = mock(async ({ where }: { where: { serverId: string } }) => {
  return (servers.find((entry) => entry.id === where.serverId)?.members ?? []).map((userId) => ({ userId }));
});

const updateCategory = mock(async ({ where, data }: { where: { id: string }; data: { position: number } }) => {
  await Promise.resolve();
  const row = categories.find((entry) => entry.id === where.id);
  if (!row) throw new Error('Category not found');
  row.position = data.position;
  return { id: row.id, name: row.name, position: row.position };
});

const updateChannel = mock(async ({ where, data }: { where: { id: string }; data: { categoryId: string | null; position: number } }) => {
  await Promise.resolve();
  if (where.id === failChannelUpdateId) throw new Error('Channel update failed');
  const row = channels.find((entry) => entry.id === where.id);
  if (!row) throw new Error('Channel not found');
  row.categoryId = data.categoryId;
  row.position = data.position;
  return { id: row.id, name: row.name, type: row.type, categoryId: row.categoryId, position: row.position };
});

const transaction = async (operations: Promise<unknown>[]) => {
  const categorySnapshot = categories.map((row) => ({ ...row }));
  const channelSnapshot = channels.map((row) => ({ ...row }));
  const results = await Promise.allSettled(operations);
  const rejected = results.find((result) => result.status === 'rejected');

  if (rejected) {
    categories = categorySnapshot;
    channels = channelSnapshot;
    throw rejected.reason;
  }

  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value);
};

mock.module('../db', () => ({
  prisma: {
    server: { findFirst: findServer },
    channelCategory: { findMany: findCategories, update: updateCategory },
    channel: { findMany: findChannels, update: updateChannel },
    serverMember: { findMany: findMembers },
    $transaction: transaction,
  },
}));

const { default: serversRoute } = await import('./servers');

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'alice' });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/servers', serversRoute);

  return app;
};

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/servers', serversRoute);

const seedServer = (suffix: string) => {
  const ownerId = `owner-${suffix}`;
  const memberId = `member-${suffix}`;
  const serverId = `server-${suffix}`;

  servers.push({ id: serverId, ownerId, members: [ownerId, memberId] });

  return { serverId, ownerId, memberId, ownerApp: createApp(ownerId), memberApp: createApp(memberId), outsiderApp: createApp(`outsider-${suffix}`) };
};

const addCategory = (serverId: string, id: string, position: number) => {
  categories.push({ id, serverId, name: id, position, createdAt: new Date() });
};

const addChannel = (serverId: string, id: string, categoryId: string | null, position: number) => {
  channels.push({ id, serverId, name: id, type: 'TEXT', categoryId, position, createdAt: new Date() });
};

const seedLayout = (suffix: string) => {
  const seeded = seedServer(suffix);
  addCategory(seeded.serverId, `cat-a-${suffix}`, 0);
  addCategory(seeded.serverId, `cat-b-${suffix}`, 1);
  addChannel(seeded.serverId, `ch-u-${suffix}`, null, 0);
  addChannel(seeded.serverId, `ch-a-${suffix}`, `cat-a-${suffix}`, 0);
  addChannel(seeded.serverId, `ch-b-${suffix}`, `cat-b-${suffix}`, 0);
  return seeded;
};

const layoutPayload = (suffix: string) => ({
  categories: [`cat-b-${suffix}`, `cat-a-${suffix}`],
  groups: [
    { categoryId: `cat-b-${suffix}`, channelIds: [`ch-a-${suffix}`] },
    { categoryId: null, channelIds: [`ch-b-${suffix}`] },
    { categoryId: `cat-a-${suffix}`, channelIds: [`ch-u-${suffix}`] },
  ],
});

const putLayout = (app: Hono<{ Variables: Variables }>, serverId: string, body: unknown) =>
  app.request(`/servers/${serverId}/layout`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  servers = [];
  categories = [];
  channels = [];
  events = [];
  failChannelUpdateId = null;
  stopEvents = eventBus.subscribe((event) => events.push(event));
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('requires authentication', async () => {
  expect((await putLayout(unauthenticated, 'server-any', { categories: [], groups: [] })).status).toBe(401);
});

test('rejects non-members with 404 and members without ownership with 403', async () => {
  const { serverId, memberApp, outsiderApp } = seedLayout('layout-access');

  expect((await putLayout(outsiderApp, serverId, layoutPayload('layout-access'))).status).toBe(404);
  expect((await putLayout(memberApp, serverId, layoutPayload('layout-access'))).status).toBe(403);
  expect(events).toEqual([]);
});

test('applies the layout and publishes the same payload', async () => {
  const { serverId, ownerApp } = seedLayout('layout-ok');

  const response = await putLayout(ownerApp, serverId, layoutPayload('layout-ok'));

  expect(response.status).toBe(200);

  const layout = (await response.json()) as LayoutResponse;

  expect(events).toEqual([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      layout,
      recipientIds: ['owner-layout-ok', 'member-layout-ok'],
    },
  ]);
  expect(Object.fromEntries(layout.categories.map((entry) => [entry.id, entry.position]))).toEqual({
    'cat-a-layout-ok': 1,
    'cat-b-layout-ok': 0,
  });
  expect(Object.fromEntries(layout.channels.map((entry) => [entry.id, [entry.categoryId, entry.position]]))).toEqual({
    'ch-a-layout-ok': ['cat-b-layout-ok', 0],
    'ch-b-layout-ok': [null, 0],
    'ch-u-layout-ok': ['cat-a-layout-ok', 0],
  });
});

test('rejects an invalid layout without writing', async () => {
  const { serverId, ownerApp } = seedLayout('layout-invalid');
  const base = layoutPayload('layout-invalid');
  const [catB, nullGroup, catA] = base.groups;

  const invalidBodies = [
    {},
    { categories: 'nope', groups: [] },
    { ...base, categories: ['cat-a-layout-invalid', 'cat-a-layout-invalid'] },
    { ...base, categories: ['cat-a-layout-invalid'] },
    { ...base, categories: ['cat-a-layout-invalid', 'cat-b-layout-invalid', 'cat-foreign'] },
    { ...base, groups: [catB, nullGroup, nullGroup] },
    { ...base, groups: base.groups.slice(0, 2) },
    { ...base, groups: [catB, nullGroup, { ...catA, channelIds: ['ch-a-layout-invalid'] }] },
    { ...base, groups: [catB, nullGroup, { ...catA, channelIds: ['ch-foreign'] }] },
    { ...base, groups: [catB, nullGroup, { ...catA, channelIds: [] }] },
  ];

  for (const body of invalidBodies) {
    const response = await putLayout(ownerApp, serverId, body);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid layout');
  }

  expect(events).toEqual([]);
  expect(categories.map((entry) => [entry.id, entry.position])).toEqual([
    ['cat-a-layout-invalid', 0],
    ['cat-b-layout-invalid', 1],
  ]);
  expect(channels.map((entry) => [entry.id, entry.categoryId, entry.position])).toEqual([
    ['ch-u-layout-invalid', null, 0],
    ['ch-a-layout-invalid', 'cat-a-layout-invalid', 0],
    ['ch-b-layout-invalid', 'cat-b-layout-invalid', 0],
  ]);
});

test('rolls back and publishes nothing when an update fails', async () => {
  const { serverId, ownerApp } = seedLayout('layout-rollback');
  failChannelUpdateId = 'ch-u-layout-rollback';

  const response = await putLayout(ownerApp, serverId, layoutPayload('layout-rollback'));

  expect(response.status).toBe(500);
  expect(events).toEqual([]);
  expect(categories.map((entry) => [entry.id, entry.position])).toEqual([
    ['cat-a-layout-rollback', 0],
    ['cat-b-layout-rollback', 1],
  ]);
  expect(channels.map((entry) => [entry.id, entry.categoryId, entry.position])).toEqual([
    ['ch-u-layout-rollback', null, 0],
    ['ch-a-layout-rollback', 'cat-a-layout-rollback', 0],
    ['ch-b-layout-rollback', 'cat-b-layout-rollback', 0],
  ]);
});

test('throttles layout updates per user after 60 requests', async () => {
  const { serverId, ownerApp } = seedLayout('layout-throttle');
  const statuses: number[] = [];

  for (let index = 0; index < 61; index++) {
    statuses.push((await putLayout(ownerApp, serverId, layoutPayload('layout-throttle'))).status);
  }

  expect(statuses.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => 200));
  expect(statuses[60]).toBe(429);
});
