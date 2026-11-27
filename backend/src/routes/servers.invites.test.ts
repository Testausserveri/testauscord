import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type ServerRow = { id: string; name: string; ownerId: string; createdAt: Date; members: string[] };
type ChannelRow = { id: string; serverId: string; name: string };
type InviteRow = { id: string; code: string; serverId: string; channelId: string | null; createdById: string; createdAt: Date; expiresAt: Date };

let servers: ServerRow[] = [];
let channels: ChannelRow[] = [];
let invites: InviteRow[] = [];
let codeCounter = 0;

const toServer = (server: ServerRow) => ({
  id: server.id,
  name: server.name,
  iconVersion: null,
  ownerId: server.ownerId,
  createdAt: server.createdAt,
  channels: channels.filter((channel) => channel.serverId === server.id).map((channel, position) => ({ id: channel.id, name: channel.name, type: 'TEXT', categoryId: null, position })),
  categories: [],
  roles: [{ id: `role-${server.id}`, name: '@everyone', color: null, permissions: 0, position: 0, isDefault: true }],
});

const userRef = (id: string) => ({ id, username: id, displayName: null, avatarVersion: null });

const findServer = mock(async ({ where }: { where: { id: string; members: { some: { userId: string } } } }) => {
  const server = servers.find((entry) => entry.id === where.id && entry.members.includes(where.members.some.userId));
  return server ? { id: server.id, ownerId: server.ownerId } : null;
});

const findChannel = mock(async ({ where }: { where: { id: string; serverId: string } }) => {
  const channel = channels.find((entry) => entry.id === where.id && entry.serverId === where.serverId);
  return channel ? { id: channel.id } : null;
});

const deleteInvites = mock(async ({ where }: { where: { serverId: string; expiresAt?: { lte: Date } } }) => {
  const before = invites.length;
  invites = invites.filter((invite) => {
    if (invite.serverId !== where.serverId) return true;
    if (where.expiresAt && invite.expiresAt.getTime() > where.expiresAt.lte.getTime()) return true;
    return false;
  });

  return { count: before - invites.length };
});

const countInvites = mock(async ({ where }: { where: { serverId: string } }) => invites.filter((invite) => invite.serverId === where.serverId).length);

const findInviteForChannel = mock(async ({ where }: { where: { serverId: string; channelId: string | null } }) => {
  const invite = invites
    .filter((entry) => entry.serverId === where.serverId && entry.channelId === where.channelId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];

  return invite ? { code: invite.code } : null;
});

const createInvite = mock(async ({ data }: { data: Omit<InviteRow, 'createdAt'> }) => {
  invites.push({ ...data, createdAt: new Date() });
  return { code: data.code };
});

const listInvites = mock(async ({ where }: { where: { serverId: string; expiresAt: { gt: Date } } }) => {
  return invites
    .filter((invite) => invite.serverId === where.serverId && invite.expiresAt.getTime() > where.expiresAt.gt.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((invite) => ({
      code: invite.code,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      channel: invite.channelId ? { id: invite.channelId, name: channels.find((channel) => channel.id === invite.channelId)?.name ?? 'gone' } : null,
      createdBy: userRef(invite.createdById),
    }));
});

const findInviteByCode = mock(async ({ where }: { where: { code: string } }) => {
  const invite = invites.find((entry) => entry.code === where.code);
  const server = invite && servers.find((entry) => entry.id === invite.serverId);
  if (!invite || !server) return null;

  const channel = invite.channelId ? channels.find((entry) => entry.id === invite.channelId) : null;

  return {
    id: invite.id,
    serverId: invite.serverId,
    expiresAt: invite.expiresAt,
    channelId: invite.channelId,
    channel: channel ? { id: channel.id, serverId: channel.serverId } : null,
    server: toServer(server),
  };
});

const findBan = mock(async () => null);

const findMember = mock(async ({ where }: { where: { serverId_userId: { serverId: string; userId: string } } }) => {
  const { serverId, userId } = where.serverId_userId;
  const server = servers.find((entry) => entry.id === serverId);
  return server?.members.includes(userId) ? { id: `member-${serverId}-${userId}` } : null;
});

const countMemberships = mock(async ({ where }: { where: { userId: string } }) => {
  return servers.filter((server) => server.members.includes(where.userId)).length;
});

const findLastPosition = mock(async ({ where }: { where: { userId: string; serverId?: string } }) => {
  if (where.serverId !== undefined) {
    const server = servers.find((entry) => entry.id === where.serverId);
    if (!server || !server.members.includes(where.userId)) return null;

    return { server: { ownerId: server.ownerId, roles: [] }, roles: [] };
  }

  const memberships = servers.map((server, index) => (server.members.includes(where.userId) ? index : -1)).filter((index) => index >= 0);
  return memberships.length > 0 ? { position: Math.max(...memberships) } : null;
});

const createMember = mock(async ({ data }: { data: { id: string; serverId: string; userId: string; position: number } }) => {
  servers.find((server) => server.id === data.serverId)?.members.push(data.userId);
  return { id: data.id };
});

const findServerMembers = mock(async ({ where }: { where: { serverId: string } }) => {
  return (servers.find((server) => server.id === where.serverId)?.members ?? []).map((userId) => ({ userId }));
});

const queryRaw = mock(async () => [{ id: 'locked' }]);

const tx = {
  $queryRaw: queryRaw,
  serverInvite: { deleteMany: deleteInvites, count: countInvites, findFirst: findInviteForChannel, create: createInvite },
};

let txQueue: Promise<unknown> = Promise.resolve();

const transaction = mock(async (fn: (client: typeof tx) => Promise<unknown>) => {
  const run = txQueue.then(() => fn(tx));
  txQueue = run.catch(() => {});
  return run;
});

mock.module('../db', () => ({
  prisma: {
    server: { findFirst: findServer },
    channel: { findFirst: findChannel },
    serverInvite: {
      findUnique: findInviteByCode,
      findMany: listInvites,
      deleteMany: deleteInvites,
      count: countInvites,
      findFirst: findInviteForChannel,
      create: createInvite,
    },
    serverBan: { findUnique: findBan },
    serverMember: {
      findUnique: findMember,
      findFirst: findLastPosition,
      findMany: findServerMembers,
      count: countMemberships,
      create: createMember,
    },
    $transaction: transaction,
  },
}));

const { default: serversRoute } = await import('./servers');

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: id });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/servers', serversRoute);

  return app;
};

const post = (app: Hono<{ Variables: Variables }>, path: string, body?: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

const seedServer = (suffix: string, ownerId = `owner-${suffix}`, members: string[] = []) => {
  const server = { id: `server-${suffix}`, name: `Server ${suffix}`, ownerId, createdAt: new Date('2026-01-01T00:00:00Z'), members: [ownerId, ...members] };
  servers.push(server);
  return server;
};

const seedChannel = (serverId: string, suffix: string, name = suffix) => {
  const channel = { id: `channel-${suffix}`, serverId, name };
  channels.push(channel);
  return channel;
};

const seedInvite = (serverId: string, suffix: string, channelId: string | null, createdById = 'owner-seed') => {
  const invite = {
    id: `invite-${suffix}`,
    code: `code-${suffix}`,
    serverId,
    channelId,
    createdById,
    createdAt: new Date(`2026-01-02T00:00:${String(invites.length % 60).padStart(2, '0')}Z`),
    expiresAt: new Date(Date.now() + 60_000),
  };
  invites.push(invite);
  return invite;
};

beforeEach(() => {
  servers = [];
  channels = [];
  invites = [];
  txQueue = Promise.resolve();
  findServer.mockClear();
  findChannel.mockClear();
  findInviteForChannel.mockClear();
  createInvite.mockClear();
  findInviteByCode.mockClear();
  createMember.mockClear();
  queryRaw.mockClear();
});

afterAll(() => mock.restore());

test('requires authentication', async () => {
  const unauthenticated = new Hono<{ Variables: Variables }>();
  unauthenticated.route('/servers', serversRoute);

  expect((await unauthenticated.request('/servers/server-x/invites', { method: 'POST' })).status).toBe(401);
});

test('creates an invite for a channel', async () => {
  const server = seedServer('create-channel');
  const channel = seedChannel(server.id, 'create-channel-general', 'general');

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`, { channelId: channel.id });

  expect(response.status).toBe(201);
  expect(invites).toHaveLength(1);
  expect(invites[0]?.channelId).toBe(channel.id);
  expect(queryRaw).toHaveBeenCalledTimes(1);
});

test('creates a server-wide invite without a channel', async () => {
  const server = seedServer('create-wide');

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`);

  expect(response.status).toBe(201);
  expect(invites[0]?.channelId).toBeNull();
});

test('rejects a channel from another server', async () => {
  const server = seedServer('foreign-a');
  const other = seedServer('foreign-b');
  const foreign = seedChannel(other.id, 'foreign-channel', 'general');

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`, { channelId: foreign.id });

  expect(response.status).toBe(400);
  expect(await response.text()).toBe('Invalid channel');
  expect(invites).toHaveLength(0);
});

test('rejects a non-member', async () => {
  const server = seedServer('non-member');

  const response = await post(createApp('stranger-non-member'), `/servers/${server.id}/invites`);

  expect(response.status).toBe(404);
});

test('lists the channel of each invite', async () => {
  const server = seedServer('list');
  const channel = seedChannel(server.id, 'list-general', 'general');
  seedInvite(server.id, 'list-with-channel', channel.id, server.ownerId);
  seedInvite(server.id, 'list-wide', null, server.ownerId);

  const response = await createApp(server.ownerId).request(`/servers/${server.id}/invites`);
  const body = (await response.json()) as { code: string; channel: { id: string; name: string } | null }[];

  expect(response.status).toBe(200);
  expect(body.find((entry) => entry.code === 'code-list-with-channel')?.channel).toEqual({ id: channel.id, name: 'general' });
  expect(body.find((entry) => entry.code === 'code-list-wide')?.channel).toBeNull();
});

test('join returns the invite channel', async () => {
  const server = seedServer('join-channel', 'owner-join-channel', []);
  const channel = seedChannel(server.id, 'join-channel-general', 'general');
  seedInvite(server.id, 'join-channel', channel.id, server.ownerId);

  const response = await post(createApp('newcomer-join-channel'), '/servers/join', { code: 'code-join-channel' });
  const body = (await response.json()) as { id: string; inviteChannelId: string | null };

  expect(response.status).toBe(201);
  expect(body.id).toBe(server.id);
  expect(body.inviteChannelId).toBe(channel.id);
});

test('an existing member join also returns the invite channel', async () => {
  const server = seedServer('join-existing', 'owner-join-existing', ['member-join-existing']);
  const channel = seedChannel(server.id, 'join-existing-general', 'general');
  seedInvite(server.id, 'join-existing', channel.id, server.ownerId);

  const response = await post(createApp('member-join-existing'), '/servers/join', { code: 'code-join-existing' });
  const body = (await response.json()) as { inviteChannelId: string | null };

  expect(response.status).toBe(200);
  expect(body.inviteChannelId).toBe(channel.id);
});

test('join falls back to null when the invite channel is gone', async () => {
  const server = seedServer('join-gone');
  seedInvite(server.id, 'join-gone', 'channel-deleted', server.ownerId);

  const response = await post(createApp('newcomer-join-gone'), '/servers/join', { code: 'code-join-gone' });
  const body = (await response.json()) as { inviteChannelId: string | null };

  expect(response.status).toBe(201);
  expect(body.inviteChannelId).toBeNull();
});

test('a server-wide invite returns a null channel', async () => {
  const server = seedServer('join-wide');
  seedInvite(server.id, 'join-wide', null, server.ownerId);

  const response = await post(createApp('newcomer-join-wide'), '/servers/join', { code: 'code-join-wide' });
  const body = (await response.json()) as { inviteChannelId: string | null };

  expect(body.inviteChannelId).toBeNull();
});

test('the owner at the cap reuses an invite for the same channel', async () => {
  const server = seedServer('cap-reuse');
  const channel = seedChannel(server.id, 'cap-reuse-general', 'general');
  for (let index = 0; index < 49; index++) seedInvite(server.id, `cap-reuse-${index}`, null, server.ownerId);
  const matching = seedInvite(server.id, 'cap-reuse-match', channel.id, server.ownerId);

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`, { channelId: channel.id });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ code: matching.code });
  expect(invites).toHaveLength(50);
});

test('the owner at the cap without a same-channel invite gets 409', async () => {
  const server = seedServer('cap-no-match');
  const channel = seedChannel(server.id, 'cap-no-match-general', 'general');
  for (let index = 0; index < 50; index++) seedInvite(server.id, `cap-no-match-${index}`, null, server.ownerId);

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`, { channelId: channel.id });

  expect(response.status).toBe(409);
  expect(await response.text()).toBe('Invite limit reached');
  expect(invites).toHaveLength(50);
});

test('the owner at the cap does not reuse an invite for a different channel', async () => {
  const server = seedServer('cap-different');
  const channel = seedChannel(server.id, 'cap-different-general', 'general');
  const other = seedChannel(server.id, 'cap-different-other', 'other');
  for (let index = 0; index < 49; index++) seedInvite(server.id, `cap-different-${index}`, null, server.ownerId);
  seedInvite(server.id, 'cap-different-match', other.id, server.ownerId);

  const response = await post(createApp(server.ownerId), `/servers/${server.id}/invites`, { channelId: channel.id });

  expect(response.status).toBe(409);
  expect(invites).toHaveLength(50);
});

test('a non-owner at the cap gets 409', async () => {
  const server = seedServer('cap-member', 'owner-cap-member', ['member-cap-member']);
  for (let index = 0; index < 50; index++) seedInvite(server.id, `cap-member-${index}`, null, server.ownerId);

  const response = await post(createApp('member-cap-member'), `/servers/${server.id}/invites`);

  expect(response.status).toBe(409);
});

test('concurrent creates cannot exceed the cap', async () => {
  const server = seedServer('cap-race');
  const firstChannel = seedChannel(server.id, 'cap-race-first', 'first');
  const secondChannel = seedChannel(server.id, 'cap-race-second', 'second');
  for (let index = 0; index < 49; index++) seedInvite(server.id, `cap-race-${index}`, null, server.ownerId);
  const app = createApp(server.ownerId);

  const [first, second] = await Promise.all([post(app, `/servers/${server.id}/invites`, { channelId: firstChannel.id }), post(app, `/servers/${server.id}/invites`, { channelId: secondChannel.id })]);

  expect([first.status, second.status].sort()).toEqual([201, 409]);
  expect(invites).toHaveLength(50);
});
