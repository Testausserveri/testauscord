import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type ServerRow = { id: string; name: string; ownerId: string; members: string[] };
type CategoryRow = { id: string; serverId: string; name: string; position: number; createdAt: Date };
type ChannelRow = { id: string; serverId: string; name: string; type: 'TEXT' | 'DM'; categoryId: string | null; position: number; createdAt: Date };
type CategoryWhere = {
  id?: string | { not: string };
  serverId?: string;
  name?: string | { equals: string; mode?: string };
};

let servers: ServerRow[] = [];
let categories: CategoryRow[] = [];
let channels: ChannelRow[] = [];
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;
let failCategoryCreate = false;

const uniqueError = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

const matchesCategory = (category: CategoryRow, where: CategoryWhere) => {
  if (typeof where.id === 'string' && category.id !== where.id) return false;
  if (typeof where.id === 'object' && category.id === where.id.not) return false;
  if (where.serverId !== undefined && category.serverId !== where.serverId) return false;

  if (where.name !== undefined) {
    const expected = typeof where.name === 'string' ? where.name : where.name.equals;
    const insensitive = typeof where.name === 'object' && where.name.mode === 'insensitive';
    const matches = insensitive ? category.name.toLowerCase() === expected.toLowerCase() : category.name === expected;
    if (!matches) return false;
  }

  return true;
};

const findServer = mock(async ({ where }: { where: { id: string; members: { some: { userId: string } } } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server || !server.members.includes(where.members.some.userId)) return null;
  return { id: server.id, ownerId: server.ownerId };
});

const findCategory = mock(async ({ where }: { where: CategoryWhere }) => {
  const category = categories.find((entry) => matchesCategory(entry, where));
  return category ? { id: category.id, name: category.name, position: category.position } : null;
});

const findCategories = mock(async ({ where }: { where: { serverId: string } }) => {
  return categories
    .filter((entry) => entry.serverId === where.serverId)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, position: entry.position }));
});

const countCategories = mock(async ({ where }: { where: { serverId: string } }) => {
  return categories.filter((entry) => entry.serverId === where.serverId).length;
});

const createCategory = mock(async ({ data }: { data: { id: string; serverId: string; name: string; position: number } }) => {
  if (failCategoryCreate) {
    failCategoryCreate = false;
    throw uniqueError();
  }

  const row = { ...data, createdAt: new Date() };
  categories.push(row);
  return { id: row.id, name: row.name, position: row.position };
});

const updateCategory = mock(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
  const row = categories.find((entry) => entry.id === where.id);
  if (!row) throw new Error('Category not found');

  row.name = data.name;
  return { id: row.id, name: row.name, position: row.position };
});

const deleteCategory = mock(async ({ where }: { where: { id: string } }) => {
  const row = categories.find((entry) => entry.id === where.id);
  if (!row) throw new Error('Category not found');

  categories = categories.filter((entry) => entry.id !== where.id);
  return row;
});

const findChannels = mock(async ({ where }: { where: { serverId: string; categoryId?: string | null } }) => {
  return channels
    .filter((entry) => entry.serverId === where.serverId && (where.categoryId === undefined || entry.categoryId === where.categoryId))
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((entry) => ({ id: entry.id, name: entry.name, type: entry.type, categoryId: entry.categoryId, position: entry.position }));
});

const findChannel = mock(async ({ where }: { where: { id: string; serverId: string } }) => {
  const row = channels.find((entry) => entry.id === where.id && entry.serverId === where.serverId);
  return row ? { id: row.id, name: row.name, type: row.type, categoryId: row.categoryId, position: row.position } : null;
});

const countChannels = mock(async ({ where }: { where: { serverId: string } }) => {
  return channels.filter((entry) => entry.serverId === where.serverId).length;
});

const findMembers = mock(async ({ where }: { where: { serverId: string } }) => {
  return (servers.find((entry) => entry.id === where.serverId)?.members ?? []).map((userId) => ({ userId }));
});

const createChannel = mock(async ({ data }: { data: { id: string; serverId: string; name: string; type: 'TEXT'; categoryId: string | null; position: number } }) => {
  if (channels.some((entry) => entry.serverId === data.serverId && entry.name === data.name)) throw uniqueError();

  const row = { ...data, createdAt: new Date() };
  channels.push(row);
  return { id: row.id, name: row.name, type: row.type, categoryId: row.categoryId, position: row.position };
});

const updateChannel = mock(async ({ where, data }: { where: { id: string }; data: { categoryId: string | null; position: number } }) => {
  const row = channels.find((entry) => entry.id === where.id);
  if (!row) throw new Error('Channel not found');

  row.categoryId = data.categoryId;
  row.position = data.position;
  return row;
});

const prismaMock = {
  server: { findFirst: findServer },
  channelCategory: {
    findFirst: findCategory,
    findMany: findCategories,
    count: countCategories,
    create: createCategory,
    update: updateCategory,
    delete: deleteCategory,
  },
  channel: {
    findMany: findChannels,
    findFirst: findChannel,
    count: countChannels,
    create: createChannel,
    update: updateChannel,
  },
  serverMember: { findMany: findMembers },
};

const transaction = async (operations: Promise<unknown>[]) => Promise.all(operations);

mock.module('../db', () => ({
  prisma: {
    ...prismaMock,
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

type ChannelSeed = { id?: string; name?: string; categoryId?: string | null; position?: number };

const seedServer = (suffix: string, channelSeeds: ChannelSeed[] = []) => {
  const ownerId = `owner-${suffix}`;
  const memberId = `member-${suffix}`;
  const serverId = `server-${suffix}`;

  servers.push({ id: serverId, name: `Server ${suffix}`, ownerId, members: [ownerId, memberId] });

  channelSeeds.forEach((seed, index) => {
    channels.push({
      id: seed.id ?? `channel-${suffix}-${index}`,
      serverId,
      name: seed.name ?? `channel-${index}`,
      type: 'TEXT',
      categoryId: seed.categoryId ?? null,
      position: seed.position ?? index,
      createdAt: new Date(),
    });
  });

  return { serverId, ownerId, memberId, ownerApp: createApp(ownerId), memberApp: createApp(memberId), outsiderApp: createApp(`outsider-${suffix}`) };
};

const addCategory = (serverId: string, name: string, position = 0) => {
  const row = { id: `category-${crypto.randomUUID()}`, serverId, name, position, createdAt: new Date() };
  categories.push(row);
  return row;
};

const call = (app: Hono<{ Variables: Variables }>, path: string, method: string, body?: unknown) =>
  app.request(`/servers${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const post = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) => call(app, path, 'POST', body);
const patch = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) => call(app, path, 'PATCH', body);
const del = (app: Hono<{ Variables: Variables }>, path: string) => call(app, path, 'DELETE');

beforeEach(() => {
  servers = [];
  categories = [];
  channels = [];
  events = [];
  failCategoryCreate = false;
  stopEvents = eventBus.subscribe((event) => events.push(event));
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('creates a trimmed category at the next position', async () => {
  const { serverId, ownerApp } = seedServer('create');
  addCategory(serverId, 'Existing', 0);

  const response = await post(ownerApp, `/${serverId}/categories`, { name: '  Projects  ' });
  const category = (await response.json()) as { id: string; name: string; position: number };

  expect(response.status).toBe(201);
  expect(category).toEqual({ id: expect.any(String), name: 'Projects', position: 1 });
  expect(events).toEqual([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      layout: {
        categories: [
          { id: expect.any(String), name: 'Existing', position: 0 },
          { id: category.id, name: 'Projects', position: 1 },
        ],
        channels: [],
      },
      recipientIds: ['owner-create', 'member-create'],
    },
  ]);
});

test('guards category creation by membership and ownership', async () => {
  const { serverId, ownerApp, memberApp, outsiderApp } = seedServer('create-access');

  expect((await post(memberApp, `/${serverId}/categories`, { name: 'Nope' })).status).toBe(403);
  expect((await post(outsiderApp, `/${serverId}/categories`, { name: 'Nope' })).status).toBe(404);
  expect((await post(ownerApp, '/server-unknown/categories', { name: 'Nope' })).status).toBe(404);
  expect((await post(unauthenticated, `/${serverId}/categories`, { name: 'Nope' })).status).toBe(401);
  expect(categories).toEqual([]);
});

test('rejects invalid category names', async () => {
  const { serverId, ownerApp } = seedServer('validation');
  const bodies = [{}, { name: '' }, { name: '   ' }, { name: 'a'.repeat(51) }, { name: 5 }, { name: 'bad\u0007' }, { name: 'bad\u202E' }];

  for (const body of bodies) {
    expect((await post(ownerApp, `/${serverId}/categories`, body)).status).toBe(400);
  }
});

test('rejects duplicate category names case-insensitively', async () => {
  const { serverId, ownerApp } = seedServer('duplicate');
  addCategory(serverId, 'General', 0);

  expect((await post(ownerApp, `/${serverId}/categories`, { name: 'general' })).status).toBe(409);
  expect((await post(ownerApp, `/${serverId}/categories`, { name: 'GENERAL' })).status).toBe(409);
});

test('maps a unique constraint race on category create to 409', async () => {
  const { serverId, ownerApp } = seedServer('category-race');
  failCategoryCreate = true;

  expect((await post(ownerApp, `/${serverId}/categories`, { name: 'General' })).status).toBe(409);
});

test('caps categories at 20 per server', async () => {
  const { serverId, ownerApp } = seedServer('category-limit');
  for (let index = 0; index < 20; index++) addCategory(serverId, `Category ${index}`, index);

  const response = await post(ownerApp, `/${serverId}/categories`, { name: 'One too many' });

  expect(response.status).toBe(409);
  expect(categories).toHaveLength(20);
});

test('renames a category', async () => {
  const { serverId, ownerApp } = seedServer('rename');
  const category = addCategory(serverId, 'General', 0);

  const response = await patch(ownerApp, `/${serverId}/categories/${category.id}`, { name: '  Projects  ' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: category.id, name: 'Projects', position: 0 });
  expect(events).toEqual([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      layout: { categories: [{ id: category.id, name: 'Projects', position: 0 }], channels: [] },
      recipientIds: ['owner-rename', 'member-rename'],
    },
  ]);
});

test('treats the same category name as a no-op', async () => {
  const { serverId, ownerApp } = seedServer('rename-noop');
  const category = addCategory(serverId, 'General', 0);

  const response = await patch(ownerApp, `/${serverId}/categories/${category.id}`, { name: 'General' });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: 'General' });
});

test('rejects a duplicate category rename', async () => {
  const { serverId, ownerApp } = seedServer('rename-duplicate');
  addCategory(serverId, 'General', 0);
  const category = addCategory(serverId, 'Projects', 1);

  expect((await patch(ownerApp, `/${serverId}/categories/${category.id}`, { name: 'general' })).status).toBe(409);
});

test('hides foreign and missing categories from rename', async () => {
  const { serverId, ownerApp } = seedServer('rename-foreign');
  const other = seedServer('rename-foreign-other');
  const foreign = addCategory(other.serverId, 'Foreign', 0);

  expect((await patch(ownerApp, `/${serverId}/categories/${foreign.id}`, { name: 'Nope' })).status).toBe(404);
  expect((await patch(ownerApp, `/${serverId}/categories/missing`, { name: 'Nope' })).status).toBe(404);
});

test('guards category rename by membership and ownership', async () => {
  const { serverId, memberApp, outsiderApp } = seedServer('rename-access');
  const category = addCategory(serverId, 'General', 0);

  expect((await patch(memberApp, `/${serverId}/categories/${category.id}`, { name: 'Nope' })).status).toBe(403);
  expect((await patch(outsiderApp, `/${serverId}/categories/${category.id}`, { name: 'Nope' })).status).toBe(404);
  expect((await patch(unauthenticated, `/${serverId}/categories/${category.id}`, { name: 'Nope' })).status).toBe(401);
});

test('rejects an invalid category rename', async () => {
  const { serverId, ownerApp } = seedServer('rename-validation');
  const category = addCategory(serverId, 'General', 0);

  expect((await patch(ownerApp, `/${serverId}/categories/${category.id}`, { name: '' })).status).toBe(400);
});

test('deletes a category and appends its channels to uncategorized', async () => {
  const category = { id: 'category-delete' };
  const { serverId, ownerApp } = seedServer('delete', [
    { id: 'u0', position: 0 },
    { id: 'u1', position: 1 },
    { id: 'c0', categoryId: category.id, position: 0 },
    { id: 'c1', categoryId: category.id, position: 1 },
    { id: 'c2', categoryId: category.id, position: 2 },
  ]);
  categories.push({ ...category, serverId, name: 'Projects', position: 0, createdAt: new Date() });

  const response = await del(ownerApp, `/${serverId}/categories/${category.id}`);

  expect(response.status).toBe(204);
  expect(categories).toEqual([]);
  expect(channels.map((channel) => [channel.id, channel.categoryId, channel.position])).toEqual([
    ['u0', null, 0],
    ['u1', null, 1],
    ['c0', null, 2],
    ['c1', null, 3],
    ['c2', null, 4],
  ]);
  expect(events).toEqual([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      layout: {
        categories: [],
        channels: [
          { id: 'u0', name: 'channel-0', type: 'TEXT', categoryId: null, position: 0 },
          { id: 'u1', name: 'channel-1', type: 'TEXT', categoryId: null, position: 1 },
          { id: 'c0', name: 'channel-2', type: 'TEXT', categoryId: null, position: 2 },
          { id: 'c1', name: 'channel-3', type: 'TEXT', categoryId: null, position: 3 },
          { id: 'c2', name: 'channel-4', type: 'TEXT', categoryId: null, position: 4 },
        ],
      },
      recipientIds: ['owner-delete', 'member-delete'],
    },
  ]);
});

test('deletes an empty category without moving uncategorized channels', async () => {
  const { serverId, ownerApp } = seedServer('delete-empty', [
    { id: 'u0', position: 0 },
    { id: 'u1', position: 1 },
  ]);
  const category = addCategory(serverId, 'Empty', 0);

  expect((await del(ownerApp, `/${serverId}/categories/${category.id}`)).status).toBe(204);
  expect(channels.map((channel) => channel.position)).toEqual([0, 1]);
});

test('guards category delete by membership and returns 404 for unknown categories', async () => {
  const { serverId, ownerApp, memberApp, outsiderApp } = seedServer('delete-access');
  const category = addCategory(serverId, 'General', 0);

  expect((await del(ownerApp, `/${serverId}/categories/missing`)).status).toBe(404);
  expect((await del(memberApp, `/${serverId}/categories/${category.id}`)).status).toBe(403);
  expect((await del(outsiderApp, `/${serverId}/categories/${category.id}`)).status).toBe(404);
  expect((await del(unauthenticated, `/${serverId}/categories/${category.id}`)).status).toBe(401);
});

test('creates channels in the target group with the next position', async () => {
  const { serverId, ownerApp } = seedServer('channel-create');
  const category = addCategory(serverId, 'Projects', 0);
  channels.push({ id: 'existing', serverId, name: 'existing', type: 'TEXT', categoryId: category.id, position: 0, createdAt: new Date() });

  const uncategorized = await post(ownerApp, `/${serverId}/channels`, { name: 'general' });
  const nested = await post(ownerApp, `/${serverId}/channels`, { name: 'nested', categoryId: category.id });

  expect(uncategorized.status).toBe(201);
  expect(await uncategorized.json()).toMatchObject({ name: 'general', categoryId: null, position: 0 });
  expect(nested.status).toBe(201);
  expect(await nested.json()).toMatchObject({ name: 'nested', categoryId: category.id, position: 1 });
  expect(events).toMatchObject([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      recipientIds: ['owner-channel-create', 'member-channel-create'],
    },
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      recipientIds: ['owner-channel-create', 'member-channel-create'],
      layout: {
        categories: [{ id: category.id, name: 'Projects', position: 0 }],
        channels: expect.arrayContaining([
          expect.objectContaining({ name: 'existing', categoryId: category.id, position: 0 }),
          expect.objectContaining({ name: 'general', categoryId: null, position: 0 }),
          expect.objectContaining({ name: 'nested', categoryId: category.id, position: 1 }),
        ]),
      },
    },
  ]);
});

test('rejects an unknown category when creating a channel', async () => {
  const { serverId, ownerApp } = seedServer('channel-create-category');

  expect((await post(ownerApp, `/${serverId}/channels`, { name: 'general', categoryId: 'missing' })).status).toBe(400);
});

test('caps channels at 50 per server and rejects duplicates', async () => {
  const { serverId, ownerApp } = seedServer('channel-limits');
  channels.push({ id: 'existing', serverId, name: 'general', type: 'TEXT', categoryId: null, position: 0, createdAt: new Date() });

  expect((await post(ownerApp, `/${serverId}/channels`, { name: 'general' })).status).toBe(409);

  for (let index = 1; index < 50; index++) {
    channels.push({ id: `filled-${index}`, serverId, name: `filled-${index}`, type: 'TEXT', categoryId: null, position: index, createdAt: new Date() });
  }

  expect((await post(ownerApp, `/${serverId}/channels`, { name: 'one-too-many' })).status).toBe(409);
});

test('guards channel creation by membership and ownership', async () => {
  const { serverId, ownerApp, memberApp, outsiderApp } = seedServer('channel-create-access');

  expect((await post(memberApp, `/${serverId}/channels`, { name: 'nope' })).status).toBe(403);
  expect((await post(outsiderApp, `/${serverId}/channels`, { name: 'nope' })).status).toBe(404);
  expect((await post(ownerApp, '/server-unknown/channels', { name: 'nope' })).status).toBe(404);
  expect((await post(unauthenticated, `/${serverId}/channels`, { name: 'nope' })).status).toBe(401);
});

test('moves a channel between groups and renumbers both', async () => {
  const { serverId, ownerApp } = seedServer('assign', [
    { id: 'a0', position: 0 },
    { id: 'a1', position: 1 },
    { id: 'b0', categoryId: 'category-assign', position: 0 },
    { id: 'b1', categoryId: 'category-assign', position: 1 },
  ]);
  categories.push({ id: 'category-assign', serverId, name: 'Projects', position: 0, createdAt: new Date() });

  const response = await patch(ownerApp, `/${serverId}/channels/a1`, { categoryId: 'category-assign' });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: 'a1', categoryId: 'category-assign', position: 2 });
  expect(channels.map((channel) => [channel.id, channel.categoryId, channel.position])).toEqual([
    ['a0', null, 0],
    ['a1', 'category-assign', 2],
    ['b0', 'category-assign', 0],
    ['b1', 'category-assign', 1],
  ]);
  expect(events).toEqual([
    {
      type: 'SERVER_LAYOUT_UPDATE',
      serverId,
      layout: {
        categories: [{ id: 'category-assign', name: 'Projects', position: 0 }],
        channels: [
          { id: 'a0', name: 'channel-0', type: 'TEXT', categoryId: null, position: 0 },
          { id: 'b0', name: 'channel-2', type: 'TEXT', categoryId: 'category-assign', position: 0 },
          { id: 'b1', name: 'channel-3', type: 'TEXT', categoryId: 'category-assign', position: 1 },
          { id: 'a1', name: 'channel-1', type: 'TEXT', categoryId: 'category-assign', position: 2 },
        ],
      },
      recipientIds: ['owner-assign', 'member-assign'],
    },
  ]);
});

test('treats a same-group channel assignment as a no-op', async () => {
  const { serverId, ownerApp } = seedServer('assign-noop', [{ id: 'b0', categoryId: 'category-noop', position: 0 }]);
  categories.push({ id: 'category-noop', serverId, name: 'Projects', position: 0, createdAt: new Date() });

  const response = await patch(ownerApp, `/${serverId}/channels/b0`, { categoryId: 'category-noop' });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: 'b0', categoryId: 'category-noop', position: 0 });
  expect(events).toEqual([]);
});

test('rejects a foreign category and a foreign channel on assign', async () => {
  const { serverId, ownerApp } = seedServer('assign-foreign', [{ id: 'channel-foreign-server', position: 0 }]);
  const other = seedServer('assign-foreign-other');
  const foreign = addCategory(other.serverId, 'Foreign', 0);

  expect((await patch(ownerApp, `/${serverId}/channels/channel-foreign-server`, { categoryId: foreign.id })).status).toBe(400);
  expect((await patch(ownerApp, `/${serverId}/channels/${other.serverId}-channel`, { categoryId: null })).status).toBe(404);
});

test('guards channel assignment by membership and ownership', async () => {
  const { serverId, ownerApp, memberApp, outsiderApp } = seedServer('assign-access', [{ id: 'move-me', position: 0 }]);

  expect((await patch(ownerApp, '/server-unknown/channels/move-me', { categoryId: null })).status).toBe(404);
  expect((await patch(memberApp, `/${serverId}/channels/move-me`, { categoryId: null })).status).toBe(403);
  expect((await patch(outsiderApp, `/${serverId}/channels/move-me`, { categoryId: null })).status).toBe(404);
  expect((await patch(unauthenticated, `/${serverId}/channels/move-me`, { categoryId: null })).status).toBe(401);
  expect((await patch(ownerApp, `/${serverId}/channels/move-me`, {})).status).toBe(400);
});
