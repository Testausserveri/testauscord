import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type UserRow = {
  id: string;
  username: string;
  displayName: string | null;
  avatarVersion: number | null;
  allowDmsFromServerMembers: boolean;
};
type ChannelRow = { id: string; dmKey: string; type: string; createdAt: Date };
type MemberRow = { channelId: string; userId: string };

const alice: UserRow = { id: 'user-alice', username: 'alice', displayName: 'Alice', avatarVersion: null, allowDmsFromServerMembers: true };
const bob: UserRow = { id: 'user-bob', username: 'bob', displayName: null, avatarVersion: null, allowDmsFromServerMembers: true };
const carol: UserRow = { id: 'user-carol', username: 'carol', displayName: 'Carol', avatarVersion: null, allowDmsFromServerMembers: true };

let users: UserRow[] = [];
let friendships: { userAId: string; userBId: string }[] = [];
let sharedServer: { id: string; banned: boolean } | null = null;
let channels: ChannelRow[] = [];
let members: MemberRow[] = [];
let failNextCreate = false;
let beforeCreate: (() => void) | null = null;
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;

const dmKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const findUser = mock(async ({ where, select }: { where: { id: string }; select?: Record<string, true> }) => {
  const user = users.find((entry) => entry.id === where.id);
  if (!user) return null;
  if (!select) return user;

  return Object.fromEntries(Object.entries(select).map(([key]) => [key, user[key as keyof UserRow]]));
});

const findFriendship = mock(async ({ where }: { where: { userAId_userBId: { userAId: string; userBId: string } } }) => {
  const { userAId, userBId } = where.userAId_userBId;
  return friendships.find((entry) => entry.userAId === userAId && entry.userBId === userBId) ?? null;
});

const findServerMember = mock(async () => (sharedServer && !sharedServer.banned ? { id: sharedServer.id } : null));

const findChannel = mock(async ({ where }: { where: { dmKey: string } }) => {
  const channel = channels.find((entry) => entry.dmKey === where.dmKey);
  return channel ? { id: channel.id } : null;
});

const findChannels = mock(async ({ where }: { where: { type: string; members: { some: { userId: string } } } }) => {
  const viewerId = where.members.some.userId;

  return channels
    .filter((channel) => channel.type === where.type && members.some((entry) => entry.channelId === channel.id && entry.userId === viewerId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((channel) => ({
      id: channel.id,
      dmKey: channel.dmKey,
      createdAt: channel.createdAt,
      members: members
        .filter((entry) => entry.channelId === channel.id && entry.userId !== viewerId)
        .flatMap((entry) => {
          const user = users.find((candidate) => candidate.id === entry.userId);
          return user ? [{ user: { id: user.id, username: user.username, displayName: user.displayName, avatarVersion: user.avatarVersion } }] : [];
        }),
    }));
});

const createChannel = mock(async ({ data }: { data: { id: string; type: string; dmKey: string } }) => {
  beforeCreate?.();
  beforeCreate = null;

  if (failNextCreate) {
    failNextCreate = false;
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }

  const row = { id: data.id, dmKey: data.dmKey, type: data.type, createdAt: new Date() };
  channels.push(row);
  return { id: row.id, createdAt: row.createdAt };
});

const createChannelMembers = mock(async ({ data }: { data: MemberRow[] }) => {
  for (const row of data) {
    if (!members.some((entry) => entry.channelId === row.channelId && entry.userId === row.userId)) members.push(row);
  }
  return { count: data.length };
});

const prismaMock = {
  user: { findUnique: findUser },
  friendship: { findUnique: findFriendship },
  serverMember: { findFirst: findServerMember },
  channel: { findUnique: findChannel, findMany: findChannels, create: createChannel },
  channelMember: { createMany: createChannelMembers },
};

mock.module('../db', () => ({
  prisma: {
    ...prismaMock,
    $transaction: async (run: (tx: typeof prismaMock) => Promise<unknown>) => run(prismaMock),
  },
}));

const { default: dmsRoute } = await import('./dms');

const createApp = (user: UserRow) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id: user.id, username: user.username });
    c.set('session', { id: `session-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/dms', dmsRoute);

  return app;
};

const post = (app: Hono<{ Variables: Variables }>, body: unknown) =>
  app.request('/dms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/dms', dmsRoute);

beforeEach(() => {
  users = [alice, bob, carol];
  friendships = [];
  sharedServer = null;
  channels = [];
  members = [];
  failNextCreate = false;
  beforeCreate = null;
  events = [];
  stopEvents = eventBus.subscribe((event) => events.push(event));
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('requires authentication', async () => {
  const created = await post(unauthenticated, { userId: bob.id });
  const listed = await unauthenticated.request('/dms');

  expect(created.status).toBe(401);
  expect(listed.status).toBe(401);
});

test('rejects yourself and missing users', async () => {
  const app = createApp(alice);

  const self = await post(app, { userId: alice.id });
  const missing = await post(app, { userId: 'user-missing' });

  expect(self.status).toBe(400);
  expect(missing.status).toBe(404);
  expect(channels).toEqual([]);
});

test('creates a DM between friends and returns the existing channel', async () => {
  friendships.push({ userAId: alice.id, userBId: bob.id });
  const app = createApp(alice);

  const first = await post(app, { userId: bob.id });

  expect(first.status).toBe(201);
  const { channelId } = (await first.json()) as { channelId: string };
  expect(channels).toHaveLength(1);
  expect(channels[0]!.dmKey).toBe(dmKey(alice.id, bob.id));
  expect(members.map((entry) => entry.userId).sort()).toEqual([alice.id, bob.id].sort());
  expect(events).toEqual([{ type: 'DM_CREATE', channelId, recipientIds: [alice.id, bob.id] }]);

  const second = await post(app, { userId: bob.id });

  expect(second.status).toBe(200);
  expect(((await second.json()) as { channelId: string }).channelId).toBe(channelId);
  expect(channels).toHaveLength(1);
  expect(events).toHaveLength(1);
});

test('allows shared-server members and blocks them when privacy is off', async () => {
  sharedServer = { id: 'member-1', banned: false };

  const allowed = await post(createApp(alice), { userId: bob.id });
  expect(allowed.status).toBe(201);

  channels = [];
  members = [];
  events = [];
  users.find((entry) => entry.id === bob.id)!.allowDmsFromServerMembers = false;

  const blocked = await post(createApp(alice), { userId: bob.id });

  expect(blocked.status).toBe(403);
  expect(await blocked.text()).toBe('You cannot message this user');
  expect(channels).toEqual([]);
  expect(events).toEqual([]);
});

test('blocks users with no shared server and banned shared servers', async () => {
  const stranger = await post(createApp(alice), { userId: bob.id });
  expect(stranger.status).toBe(403);

  sharedServer = { id: 'member-1', banned: true };

  const banned = await post(createApp(alice), { userId: bob.id });
  expect(banned.status).toBe(403);
  expect(channels).toEqual([]);
});

test('reopens an existing conversation after privacy is turned off and restores memberships', async () => {
  friendships.push({ userAId: alice.id, userBId: bob.id });

  const created = await post(createApp(alice), { userId: bob.id });
  const { channelId } = (await created.json()) as { channelId: string };

  friendships = [];
  users.find((entry) => entry.id === bob.id)!.allowDmsFromServerMembers = false;
  members = [];

  const reopened = await post(createApp(alice), { userId: bob.id });

  expect(reopened.status).toBe(200);
  expect(((await reopened.json()) as { channelId: string }).channelId).toBe(channelId);
  expect(members.map((entry) => entry.userId).sort()).toEqual([alice.id, bob.id].sort());
});

test('returns the raced channel when two creates collide', async () => {
  friendships.push({ userAId: alice.id, userBId: bob.id });
  const key = dmKey(alice.id, bob.id);

  failNextCreate = true;
  beforeCreate = () => {
    channels.push({ id: 'channel-raced', dmKey: key, type: 'DM', createdAt: new Date() });
  };

  const response = await post(createApp(alice), { userId: bob.id });

  expect(response.status).toBe(200);
  expect(((await response.json()) as { channelId: string }).channelId).toBe('channel-raced');
  expect(members.map((entry) => entry.userId).sort()).toEqual([alice.id, bob.id].sort());
});

test('lists only the viewer DMs, newest first, and includes friend DMs', async () => {
  const older = new Date('2026-01-01T00:00:00.000Z');
  const newer = new Date('2026-02-01T00:00:00.000Z');

  channels = [
    { id: 'channel-bob', dmKey: dmKey(alice.id, bob.id), type: 'DM', createdAt: older },
    { id: 'channel-carol', dmKey: dmKey(alice.id, carol.id), type: 'DM', createdAt: newer },
    { id: 'channel-bob-carol', dmKey: dmKey(bob.id, carol.id), type: 'DM', createdAt: newer },
    { id: 'channel-orphan', dmKey: dmKey(alice.id, 'user-gone'), type: 'DM', createdAt: new Date('2026-03-01T00:00:00.000Z') },
  ];
  members = [
    { channelId: 'channel-bob', userId: alice.id },
    { channelId: 'channel-bob', userId: bob.id },
    { channelId: 'channel-carol', userId: alice.id },
    { channelId: 'channel-carol', userId: carol.id },
    { channelId: 'channel-bob-carol', userId: bob.id },
    { channelId: 'channel-bob-carol', userId: carol.id },
    { channelId: 'channel-orphan', userId: alice.id },
  ];

  const response = await createApp(alice).request('/dms');

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    {
      channelId: 'channel-carol',
      user: { id: carol.id, username: carol.username, displayName: carol.displayName, avatarVersion: null },
      createdAt: newer.toISOString(),
    },
    {
      channelId: 'channel-bob',
      user: { id: bob.id, username: bob.username, displayName: bob.displayName, avatarVersion: null },
      createdAt: older.toISOString(),
    },
  ]);
});
