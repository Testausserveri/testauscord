import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { Hono } from 'hono';
import { addConnection, publishToChannel, removeConnection, subscribe } from '../realtime/connections';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type UserRow = { id: string; username: string; displayName: string | null };
type ServerRow = { id: string; name: string; ownerId: string; createdAt: Date; members: string[] };
type BanRow = { id: string; serverId: string; userId: string; bannedById: string; reason: string | null; createdAt: Date };
type InviteRow = { id: string; code: string; serverId: string; createdById: string; expiresAt: Date };
type ChannelRow = { id: string; serverId: string };
type MemberKey = { serverId_userId: { serverId: string; userId: string } };
type DetailWhere = { id: string; members: { some: { userId: string } }; bans: { none: { userId: string } } };
type ManageWhere = { id: string; members: { some: { userId: string } } };
type BanUpsertArgs = {
  where: MemberKey;
  create: { id: string; serverId: string; userId: string; bannedById: string; reason: string | null };
  update: { bannedById: string; reason: string | null };
};

let users: UserRow[] = [];
let servers: ServerRow[] = [];
let bans: BanRow[] = [];
let invites: InviteRow[] = [];
let channels: ChannelRow[] = [];
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;
let createdMemberships: { serverId: string; userId: string; position?: number }[] = [];

const toServer = (server: ServerRow) => ({
  id: server.id,
  name: server.name,
  ownerId: server.ownerId,
  createdAt: server.createdAt,
  channels: [],
  categories: [],
  roles: [{ id: `role-${server.id}`, name: '@everyone', color: null, permissions: 0, position: 0, isDefault: true }],
});

const userOf = (id: string) => users.find((user) => user.id === id) ?? { id, username: id, displayName: null };

const findFirst = mock(async ({ where }: { where: DetailWhere | ManageWhere }) => {
  const server = servers.find((entry) => entry.id === where.id && entry.members.includes(where.members.some.userId));
  if (!server) return null;
  if ('bans' in where && bans.some((ban) => ban.serverId === server.id && ban.userId === where.bans.none.userId)) return null;

  return {
    ...toServer(server),
    members: server.members.map((userId) => ({
      joinedAt: server.createdAt,
      user: userOf(userId),
      roles: [],
    })),
  };
});

const findInvite = mock(async ({ where }: { where: { code: string } }) => {
  const invite = invites.find((entry) => entry.code === where.code);
  const server = invite && servers.find((entry) => entry.id === invite.serverId);

  return invite && server ? { id: invite.id, serverId: invite.serverId, expiresAt: invite.expiresAt, server: toServer(server) } : null;
});

const findBan = mock(async ({ where }: { where: MemberKey }) => {
  const { serverId, userId } = where.serverId_userId;
  return bans.find((ban) => ban.serverId === serverId && ban.userId === userId) ?? null;
});

const findBans = mock(async ({ where, take }: { where: { serverId: string }; take: number }) => {
  return bans
    .filter((ban) => ban.serverId === where.serverId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
    .slice(0, take)
    .map((ban) => ({
      reason: ban.reason,
      createdAt: ban.createdAt,
      user: userOf(ban.userId),
      bannedBy: userOf(ban.bannedById),
    }));
});

const upsertBan = mock(async ({ where, create, update }: BanUpsertArgs) => {
  const { serverId, userId } = where.serverId_userId;
  const existing = bans.find((ban) => ban.serverId === serverId && ban.userId === userId);

  if (existing) {
    existing.bannedById = update.bannedById;
    existing.reason = update.reason;
    return { id: existing.id };
  }

  bans.push({ ...create, createdAt: new Date() });
  return { id: create.id };
});

const deleteBan = mock(async ({ where }: { where: { id: string } }) => {
  bans = bans.filter((ban) => ban.id !== where.id);
  return { id: where.id };
});

const findUser = mock(async ({ where }: { where: { id: string } }) => users.find((user) => user.id === where.id) ?? null);

const findChannels = mock(async ({ where }: { where: { serverId: string } }) => {
  return channels.filter((channel) => channel.serverId === where.serverId).map((channel) => ({ id: channel.id }));
});

const findMember = mock(async ({ where }: { where: MemberKey }) => {
  const { serverId, userId } = where.serverId_userId;
  const server = servers.find((entry) => entry.id === serverId);

  return server?.members.includes(userId) ? { id: `member-${serverId}-${userId}` } : null;
});

const deleteMembership = mock(async ({ where }: { where: { id: string } }) => {
  for (const server of servers) {
    const userId = server.members.find((id) => `member-${server.id}-${id}` === where.id);
    if (userId) server.members = server.members.filter((id) => id !== userId);
  }

  return { id: where.id };
});

const deleteMemberships = mock(async ({ where }: { where: { serverId: string; userId: string } }) => {
  const server = servers.find((entry) => entry.id === where.serverId);
  const before = server?.members.length ?? 0;
  if (server) server.members = server.members.filter((id) => id !== where.userId);

  return { count: before - (server?.members.length ?? 0) };
});

const deleteInvites = mock(async ({ where }: { where: { serverId: string; createdById: string } }) => {
  const before = invites.length;
  invites = invites.filter((invite) => !(invite.serverId === where.serverId && invite.createdById === where.createdById));

  return { count: before - invites.length };
});

const countMembers = mock(async ({ where }: { where: { userId: string } }) => {
  return servers.filter((server) => server.members.includes(where.userId)).length;
});

const findMembers = mock(async ({ where }: { where: { serverId?: string; userId?: string; server?: { bans: { none: { userId: string } } } } }) => {
  if (where.userId !== undefined) {
    return servers
      .filter((server) => server.members.includes(where.userId!) && !bans.some((ban) => ban.serverId === server.id && ban.userId === where.userId))
      .map((server, position) => ({ server: toServer(server), roles: [], position }));
  }

  const server = servers.find((entry) => entry.id === where.serverId);
  return (server?.members ?? []).map((userId) => ({ userId }));
});

const findFirstMember = mock(async ({ where }: { where: { serverId?: string; userId: string } }) => {
  if (where.serverId === undefined) {
    const positions = servers.map((server, index) => (server.members.includes(where.userId) ? index : -1)).filter((index) => index >= 0);
    return positions.length > 0 ? { position: Math.max(...positions) } : null;
  }

  if (bans.some((ban) => ban.serverId === where.serverId && ban.userId === where.userId)) return null;

  const server = servers.find((entry) => entry.id === where.serverId);
  if (!server || !server.members.includes(where.userId)) return null;

  return { server: { ownerId: server.ownerId, roles: [] }, roles: [] };
});

const createMember = mock(async ({ data }: { data: { id: string; serverId: string; userId: string; position?: number } }) => {
  servers.find((server) => server.id === data.serverId)?.members.push(data.userId);
  createdMemberships.push(data);
  return { id: data.id };
});

mock.module('../db', () => ({
  prisma: {
    server: { findFirst },
    serverInvite: { findUnique: findInvite, deleteMany: deleteInvites },
    serverBan: { findUnique: findBan, findMany: findBans, upsert: upsertBan, delete: deleteBan },
    serverMember: {
      findUnique: findMember,
      findFirst: findFirstMember,
      findMany: findMembers,
      delete: deleteMembership,
      deleteMany: deleteMemberships,
      count: countMembers,
      create: createMember,
    },
    channel: { findMany: findChannels },
    user: { findUnique: findUser },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
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

const post = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) =>
  app.request(`/servers${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const put = (app: Hono<{ Variables: Variables }>, path: string, body: unknown = {}) =>
  app.request(`/servers${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const del = (app: Hono<{ Variables: Variables }>, path: string) => app.request(`/servers${path}`, { method: 'DELETE' });
const get = (app: Hono<{ Variables: Variables }>, path: string) => app.request(`/servers${path}`);

const createSocket = () => {
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN as number,
    send: (payload: string) => {
      sent.push(payload);
      return payload.length;
    },
    close: () => {
      socket.readyState = WebSocket.CLOSED;
    },
  };

  return { ws: socket as unknown as ServerWebSocket, sent };
};

const seedServer = (suffix: string) => {
  const ownerId = `owner-${suffix}`;
  const memberId = `member-${suffix}`;
  const serverId = `server-${suffix}`;

  users.push({ id: ownerId, username: ownerId, displayName: null }, { id: memberId, username: memberId, displayName: `Member ${suffix}` });
  servers.push({ id: serverId, name: `Server ${suffix}`, ownerId, createdAt: new Date('2026-01-01T00:00:00.000Z'), members: [ownerId, memberId] });
  invites.push({ id: `invite-${suffix}`, code: `code-${suffix}`, serverId, createdById: ownerId, expiresAt: new Date(Date.now() + 60_000) });
  channels.push({ id: `channel-${suffix}`, serverId });

  return { serverId, ownerId, memberId };
};

const seedBan = (serverId: string, userId: string, bannedById: string, reason: string | null, createdAt = new Date('2026-02-01T00:00:00.000Z')) => {
  const ban: BanRow = { id: `ban-${serverId}-${userId}`, serverId, userId, bannedById, reason, createdAt };
  bans.push(ban);
  return ban;
};

beforeEach(() => {
  users = [];
  servers = [];
  bans = [];
  invites = [];
  channels = [];
  events = [];
  createdMemberships = [];
  stopEvents = eventBus.subscribe((event) => events.push(event));
  findFirst.mockClear();
  findInvite.mockClear();
  findBan.mockClear();
  findBans.mockClear();
  upsertBan.mockClear();
  deleteBan.mockClear();
  findUser.mockClear();
  findChannels.mockClear();
  findMember.mockClear();
  findFirstMember.mockClear();
  deleteMembership.mockClear();
  deleteMemberships.mockClear();
  deleteInvites.mockClear();
  countMembers.mockClear();
  findMembers.mockClear();
  createMember.mockClear();
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('rejects a join from a banned user', async () => {
  const { serverId } = seedServer('join-banned');
  seedBan(serverId, 'intruder-join-banned', 'owner-join-banned', null);

  const response = await post(createApp('intruder-join-banned'), '/join', { code: 'code-join-banned' });

  expect(response.status).toBe(403);
  expect(await response.text()).toBe('You are banned from this server');
  expect(findMember).not.toHaveBeenCalled();
  expect(createMember).not.toHaveBeenCalled();
});

test('lets a previously banned user join after the ban is removed', async () => {
  const { serverId } = seedServer('unbanned');
  const ban = seedBan(serverId, 'intruder-unbanned', 'owner-unbanned', null);
  bans = bans.filter((entry) => entry.id !== ban.id);

  const response = await post(createApp('intruder-unbanned'), '/join', { code: 'code-unbanned' });

  expect(response.status).toBe(201);
  expect(servers.find((server) => server.id === serverId)?.members).toContain('intruder-unbanned');
});

test('announces a new member to everyone in the server', async () => {
  const { serverId } = seedServer('member-added');

  const response = await post(createApp('newcomer-member-added'), '/join', { code: 'code-member-added' });

  expect(response.status).toBe(201);
  expect(createdMemberships).toEqual([expect.objectContaining({ serverId, userId: 'newcomer-member-added', position: 0 })]);
  expect(events).toEqual([{ type: 'SERVER_MEMBER_ADDED', serverId, recipientIds: ['owner-member-added', 'member-member-added', 'newcomer-member-added'] }]);
});

test('a ban on one server does not block joining another', async () => {
  const banned = seedServer('ban-a');
  seedServer('ban-b');
  seedBan(banned.serverId, 'user-shared', 'owner-ban-a', null);

  const response = await post(createApp('user-shared'), '/join', { code: 'code-ban-b' });

  expect(response.status).toBe(201);
});

test('hides the server from a banned member with a stale membership row', async () => {
  const { serverId } = seedServer('hidden');
  servers[0]!.members.push('banned-hidden');
  seedBan(serverId, 'banned-hidden', 'owner-hidden', null);

  const app = createApp('banned-hidden');

  const list = await get(app, '');
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([]);
  expect(findMembers.mock.calls[0]?.[0].where).toEqual({ userId: 'banned-hidden', server: { bans: { none: { userId: 'banned-hidden' } } } });

  const detail = await get(app, `/${serverId}`);
  expect(detail.status).toBe(404);
  expect(findFirst.mock.calls[0]?.[0].where).toEqual({ id: serverId, members: { some: { userId: 'banned-hidden' } }, bans: { none: { userId: 'banned-hidden' } } });
});

test('rejects an invite from a banned member with a stale membership row', async () => {
  const { serverId } = seedServer('invite-banned');
  servers[0]!.members.push('banned-invite');
  seedBan(serverId, 'banned-invite', 'owner-invite-banned', null);

  const response = await post(createApp('banned-invite'), `/${serverId}/invites`, {});

  expect(response.status).toBe(404);
  expect(invites.some((invite) => invite.createdById === 'banned-invite')).toBe(false);
});

test('still lists the server for a member without a ban', async () => {
  const { serverId, memberId } = seedServer('visible');

  const app = createApp(memberId);

  const list = await get(app, '');
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([expect.objectContaining({ id: serverId })]);

  const detail = await get(app, `/${serverId}`);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ id: serverId, members: [{ id: `owner-visible` }, { id: memberId }] });
});

test('bans a member and removes the membership and their invites', async () => {
  const { serverId, ownerId, memberId } = seedServer('ban-member');
  invites.push({ id: 'member-invite', code: 'member-code', serverId, createdById: memberId, expiresAt: new Date(Date.now() + 60_000) });

  const response = await put(createApp(ownerId), `/${serverId}/bans/${memberId}`, { reason: '  spam  ' });

  expect(response.status).toBe(204);
  expect(servers.find((server) => server.id === serverId)?.members).not.toContain(memberId);
  expect(bans).toEqual([expect.objectContaining({ serverId, userId: memberId, bannedById: ownerId, reason: 'spam' })]);
  expect(invites.map((invite) => invite.code)).toEqual(['code-ban-member']);
  expect(events).toEqual([{ type: 'SERVER_MEMBER_REMOVED', serverId, userId: memberId, reason: 'ban' }]);
});

test('drops a banned member from every server channel', async () => {
  const { serverId, ownerId, memberId } = seedServer('ban-realtime');
  const channelId = 'channel-ban-realtime';
  const banned = createSocket();
  const watcher = createSocket();

  addConnection(banned.ws, memberId, 'session-banned', Date.now() + 60_000);
  addConnection(watcher.ws, ownerId, 'session-watcher', Date.now() + 60_000);
  subscribe(banned.ws, channelId);
  subscribe(watcher.ws, channelId);

  const response = await put(createApp(ownerId), `/${serverId}/bans/${memberId}`, {});
  publishToChannel(channelId, 'message');

  expect(response.status).toBe(204);
  expect(banned.sent).toEqual([]);
  expect(watcher.sent).toEqual(['message']);

  removeConnection(banned.ws);
  removeConnection(watcher.ws);
});

test('replaces an existing ban on a duplicate PUT', async () => {
  const { serverId, ownerId, memberId } = seedServer('ban-duplicate');
  seedBan(serverId, memberId, ownerId, 'old');

  const response = await put(createApp(ownerId), `/${serverId}/bans/${memberId}`, { reason: 'new' });

  expect(response.status).toBe(204);
  expect(bans).toHaveLength(1);
  expect(bans[0]).toMatchObject({ userId: memberId, bannedById: ownerId, reason: 'new' });
});

test('pre-bans a non-member without publishing an event', async () => {
  const { serverId, ownerId } = seedServer('pre-ban');
  users.push({ id: 'outsider-pre-ban', username: 'outsider-pre-ban', displayName: null });

  const response = await put(createApp(ownerId), `/${serverId}/bans/outsider-pre-ban`, { reason: 'watchlist' });

  expect(response.status).toBe(204);
  expect(bans).toEqual([expect.objectContaining({ serverId, userId: 'outsider-pre-ban', reason: 'watchlist' })]);
  expect(events).toEqual([]);
  expect(servers.find((server) => server.id === serverId)?.members).toEqual([ownerId, 'member-pre-ban']);
});

test('rejects a ban from a non-owner member', async () => {
  const { serverId, memberId } = seedServer('ban-non-owner');
  users.push({ id: 'target-ban-non-owner', username: 'target-ban-non-owner', displayName: null });

  const response = await put(createApp(memberId), `/${serverId}/bans/target-ban-non-owner`, {});

  expect(response.status).toBe(403);
  expect(bans).toEqual([]);
});

test('hides the ban endpoint from an outsider', async () => {
  const { serverId, memberId } = seedServer('ban-outsider');

  const response = await put(createApp('outsider-ban-outsider'), `/${serverId}/bans/${memberId}`, {});

  expect(response.status).toBe(404);
});

test('rejects banning yourself or the owner', async () => {
  const { serverId, ownerId } = seedServer('ban-self');

  const response = await put(createApp(ownerId), `/${serverId}/bans/${ownerId}`, {});

  expect(response.status).toBe(400);
  expect(bans).toEqual([]);
});

test('rejects an unknown target user', async () => {
  const { serverId, ownerId } = seedServer('ban-missing-user');

  const response = await put(createApp(ownerId), `/${serverId}/bans/ghost-ban-missing-user`, {});

  expect(response.status).toBe(404);
  expect(bans).toEqual([]);
});

test('rejects a reason over 200 characters', async () => {
  const { serverId, ownerId, memberId } = seedServer('ban-reason');

  const response = await put(createApp(ownerId), `/${serverId}/bans/${memberId}`, { reason: 'a'.repeat(201) });

  expect(response.status).toBe(400);
  expect(bans).toEqual([]);
});

test('unbans a user', async () => {
  const { serverId, ownerId, memberId } = seedServer('unban');
  seedBan(serverId, memberId, ownerId, 'spam');

  const response = await del(createApp(ownerId), `/${serverId}/bans/${memberId}`);

  expect(response.status).toBe(204);
  expect(bans).toEqual([]);
  expect(events).toEqual([]);
});

test('returns 404 when unbanning a user without a ban', async () => {
  const { serverId, ownerId, memberId } = seedServer('unban-missing');

  const response = await del(createApp(ownerId), `/${serverId}/bans/${memberId}`);

  expect(response.status).toBe(404);
});

test('lists bans for the owner, newest first', async () => {
  const { serverId, ownerId, memberId } = seedServer('ban-list');
  users.push({ id: 'other-ban-list', username: 'other-ban-list', displayName: 'Other' });
  seedBan(serverId, memberId, ownerId, 'spam', new Date('2026-02-01T00:00:00.000Z'));
  seedBan(serverId, 'other-ban-list', ownerId, null, new Date('2026-02-02T00:00:00.000Z'));

  const response = await get(createApp(ownerId), `/${serverId}/bans`);

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    {
      id: 'other-ban-list',
      username: 'other-ban-list',
      displayName: 'Other',
      reason: null,
      createdAt: '2026-02-02T00:00:00.000Z',
      bannedBy: { id: ownerId, username: ownerId, displayName: null },
    },
    {
      id: memberId,
      username: memberId,
      displayName: 'Member ban-list',
      reason: 'spam',
      createdAt: '2026-02-01T00:00:00.000Z',
      bannedBy: { id: ownerId, username: ownerId, displayName: null },
    },
  ]);
});

test('caps the ban list at 100 rows', async () => {
  const { serverId, ownerId } = seedServer('ban-cap');

  for (let index = 0; index < 101; index++) {
    seedBan(serverId, `user-cap-${index}`, ownerId, null, new Date(2026, 0, 1, 0, 0, index));
  }

  const response = await get(createApp(ownerId), `/${serverId}/bans`);

  expect(response.status).toBe(200);
  const rows = (await response.json()) as { id: string }[];
  expect(rows).toHaveLength(100);
  expect(rows[0]?.id).toBe('user-cap-100');
});

test('rejects the ban list for a non-owner member and hides it from outsiders', async () => {
  const { serverId, memberId } = seedServer('ban-list-access');

  expect((await get(createApp(memberId), `/${serverId}/bans`)).status).toBe(403);
  expect((await get(createApp('outsider-ban-list-access'), `/${serverId}/bans`)).status).toBe(404);
});

test('kicks a member, removes their invites and lets them rejoin with a fresh invite', async () => {
  const { serverId, ownerId, memberId } = seedServer('kick');
  invites.push({ id: 'member-invite-kick', code: 'member-code-kick', serverId, createdById: memberId, expiresAt: new Date(Date.now() + 60_000) });

  const response = await del(createApp(ownerId), `/${serverId}/members/${memberId}`);

  expect(response.status).toBe(204);
  expect(servers.find((server) => server.id === serverId)?.members).not.toContain(memberId);
  expect(invites.map((invite) => invite.code)).toEqual(['code-kick']);
  expect(events).toEqual([{ type: 'SERVER_MEMBER_REMOVED', serverId, userId: memberId, reason: 'kick' }]);

  invites.push({ id: 'fresh-invite-kick', code: 'fresh-code-kick', serverId, createdById: ownerId, expiresAt: new Date(Date.now() + 60_000) });
  const rejoin = await post(createApp(memberId), '/join', { code: 'fresh-code-kick' });

  expect(rejoin.status).toBe(201);
  expect(servers.find((server) => server.id === serverId)?.members).toContain(memberId);
});

test('rejects a kick from a non-owner member and hides it from outsiders', async () => {
  const { serverId, memberId } = seedServer('kick-access');

  expect((await del(createApp(memberId), `/${serverId}/members/${memberId}`)).status).toBe(403);
  expect((await del(createApp('outsider-kick-access'), `/${serverId}/members/${memberId}`)).status).toBe(404);
});

test('rejects kicking the owner or a missing member', async () => {
  const { serverId, ownerId } = seedServer('kick-targets');

  expect((await del(createApp(ownerId), `/${serverId}/members/${ownerId}`)).status).toBe(400);
  expect((await del(createApp(ownerId), `/${serverId}/members/ghost-kick-targets`)).status).toBe(404);
});

test('throttles moderation actions per actor', async () => {
  const { serverId, ownerId, memberId } = seedServer('throttle');
  const app = createApp(ownerId);
  const statuses: number[] = [];

  for (let index = 0; index < 31; index++) {
    statuses.push((await del(app, `/${serverId}/bans/${memberId}`)).status);
  }

  expect(statuses.slice(0, 30)).toEqual(Array.from({ length: 30 }, () => 404));
  expect(statuses[30]).toBe(429);
});
