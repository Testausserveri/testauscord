import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type ServerRow = { id: string; name: string; ownerId: string; createdAt: Date; members: string[] };
type BanRow = { id: string; serverId: string; userId: string };
type InviteRow = { id: string; code: string; serverId: string; expiresAt: Date };
type MemberWhere = { serverId_userId: { serverId: string; userId: string } };
type ListWhere = { members: { some: { userId: string } }; bans: { none: { userId: string } } };
type DetailWhere = ListWhere & { id: string };

let servers: ServerRow[] = [];
let bans: BanRow[] = [];
let invites: InviteRow[] = [];

const toServer = (server: ServerRow) => ({
  id: server.id,
  name: server.name,
  ownerId: server.ownerId,
  createdAt: server.createdAt,
  channels: [],
  categories: [],
});

const isVisible = (server: ServerRow, userId: string) => server.members.includes(userId) && !bans.some((ban) => ban.serverId === server.id && ban.userId === userId);

const findMany = mock(async ({ where }: { where: ListWhere }) => {
  return servers.filter((server) => isVisible(server, where.members.some.userId)).map(toServer);
});

const findFirst = mock(async ({ where }: { where: DetailWhere }) => {
  const server = servers.find((entry) => entry.id === where.id && isVisible(entry, where.members.some.userId));
  if (!server) return null;

  return {
    ...toServer(server),
    members: server.members.map((userId) => ({
      joinedAt: server.createdAt,
      user: { id: userId, username: userId, displayName: null },
    })),
  };
});

const findInvite = mock(async ({ where }: { where: { code: string } }) => {
  const invite = invites.find((entry) => entry.code === where.code);
  const server = invite && servers.find((entry) => entry.id === invite.serverId);

  return invite && server ? { id: invite.id, serverId: invite.serverId, expiresAt: invite.expiresAt, server: toServer(server) } : null;
});

const findBan = mock(async ({ where }: { where: MemberWhere }) => {
  const { serverId, userId } = where.serverId_userId;
  return bans.find((ban) => ban.serverId === serverId && ban.userId === userId) ?? null;
});

const findMember = mock(async ({ where }: { where: MemberWhere }) => {
  const { serverId, userId } = where.serverId_userId;
  const server = servers.find((entry) => entry.id === serverId);

  return server?.members.includes(userId) ? { id: `member-${serverId}-${userId}` } : null;
});

const countMembers = mock(async ({ where }: { where: { userId: string } }) => {
  return servers.filter((server) => server.members.includes(where.userId)).length;
});

const createMember = mock(async ({ data }: { data: { id: string; serverId: string; userId: string } }) => {
  servers.find((server) => server.id === data.serverId)?.members.push(data.userId);
  return { id: data.id };
});

mock.module('../db', () => ({
  prisma: {
    server: { findMany, findFirst },
    serverInvite: { findUnique: findInvite },
    serverBan: { findUnique: findBan },
    serverMember: { findUnique: findMember, count: countMembers, create: createMember },
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

const seedServer = (suffix: string) => {
  const ownerId = `owner-${suffix}`;
  const memberId = `member-${suffix}`;
  const serverId = `server-${suffix}`;

  servers.push({ id: serverId, name: `Server ${suffix}`, ownerId, createdAt: new Date('2026-01-01T00:00:00.000Z'), members: [ownerId, memberId] });
  invites.push({ id: `invite-${suffix}`, code: `code-${suffix}`, serverId, expiresAt: new Date(Date.now() + 60_000) });

  return { serverId, ownerId, memberId };
};

beforeEach(() => {
  servers = [];
  bans = [];
  invites = [];
  findMany.mockClear();
  findFirst.mockClear();
  findInvite.mockClear();
  findBan.mockClear();
  findMember.mockClear();
  countMembers.mockClear();
  createMember.mockClear();
});

afterAll(() => mock.restore());

test('rejects a join from a banned user', async () => {
  const { serverId } = seedServer('join-banned');
  bans.push({ id: 'ban-join-banned', serverId, userId: 'intruder-join-banned' });

  const response = await post(createApp('intruder-join-banned'), '/join', { code: 'code-join-banned' });

  expect(response.status).toBe(403);
  expect(await response.text()).toBe('You are banned from this server');
  expect(findMember).not.toHaveBeenCalled();
  expect(createMember).not.toHaveBeenCalled();
});

test('lets a previously banned user join after the ban is removed', async () => {
  const { serverId } = seedServer('unbanned');
  const ban = { id: 'ban-unbanned', serverId, userId: 'intruder-unbanned' };
  bans.push(ban);
  bans = bans.filter((entry) => entry.id !== ban.id);

  const response = await post(createApp('intruder-unbanned'), '/join', { code: 'code-unbanned' });

  expect(response.status).toBe(201);
  expect(servers.find((server) => server.id === serverId)?.members).toContain('intruder-unbanned');
});

test('a ban on one server does not block joining another', async () => {
  const banned = seedServer('ban-a');
  seedServer('ban-b');
  bans.push({ id: 'ban-ban-a', serverId: banned.serverId, userId: 'user-shared' });

  const response = await post(createApp('user-shared'), '/join', { code: 'code-ban-b' });

  expect(response.status).toBe(201);
});

test('hides the server from a banned member with a stale membership row', async () => {
  const { serverId } = seedServer('hidden');
  servers[0]!.members.push('banned-hidden');
  bans.push({ id: 'ban-hidden', serverId, userId: 'banned-hidden' });

  const app = createApp('banned-hidden');

  const list = await app.request('/servers');
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([]);
  expect(findMany.mock.calls[0]?.[0].where).toEqual({ members: { some: { userId: 'banned-hidden' } }, bans: { none: { userId: 'banned-hidden' } } });

  const detail = await app.request(`/servers/${serverId}`);
  expect(detail.status).toBe(404);
  expect(findFirst.mock.calls[0]?.[0].where).toEqual({ id: serverId, members: { some: { userId: 'banned-hidden' } }, bans: { none: { userId: 'banned-hidden' } } });
});

test('still lists the server for a member without a ban', async () => {
  const { serverId, memberId } = seedServer('visible');

  const app = createApp(memberId);

  const list = await app.request('/servers');
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual([expect.objectContaining({ id: serverId })]);

  const detail = await app.request(`/servers/${serverId}`);
  expect(detail.status).toBe(200);
  expect(await detail.json()).toMatchObject({ id: serverId, members: [{ id: `owner-visible` }, { id: memberId }] });
});
