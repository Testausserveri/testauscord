import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import { friendPair } from '../services/directMessages';
import type { Variables } from '../types/types';

type UserRow = { id: string; username: string; displayName: string | null; avatarVersion: number | null };
type RequestRow = { id: string; senderId: string; receiverId: string; createdAt: Date };
type FriendshipRow = { id: string; userAId: string; userBId: string; createdAt: Date };
type ChannelRow = { id: string; dmKey: string };
type MemberRow = { channelId: string; userId: string };
type RequestWhere = { id?: string; senderId?: string; receiverId?: string };
type FriendshipWhere = { userAId_userBId: { userAId: string; userBId: string } };

const alice: UserRow = { id: 'user-alice', username: 'alice', displayName: 'Alice', avatarVersion: null };
const bob: UserRow = { id: 'user-bob', username: 'bob', displayName: null, avatarVersion: null };
const carol: UserRow = { id: 'user-carol', username: 'carol', displayName: 'Carol', avatarVersion: null };

let users: UserRow[] = [];
let requests: RequestRow[] = [];
let friendships: FriendshipRow[] = [];
let channels: ChannelRow[] = [];
let members: MemberRow[] = [];
let failRequestCreate = false;
let beforeRequestDelete: (() => void) | null = null;
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;

const findUser = mock(async ({ where }: { where: { username?: string; id?: string } }) => {
  const user = where.id !== undefined ? users.find((entry) => entry.id === where.id) : users.find((entry) => entry.username === where.username);
  return user ? { id: user.id, username: user.username, displayName: user.displayName, avatarVersion: user.avatarVersion } : null;
});

const findFriendship = mock(async ({ where }: { where: FriendshipWhere }) => {
  const { userAId, userBId } = where.userAId_userBId;
  return friendships.find((entry) => entry.userAId === userAId && entry.userBId === userBId) ?? null;
});

const findPendingRequest = mock(async ({ where }: { where: { OR: { senderId: string; receiverId: string }[] } }) => {
  return requests.find((entry) => where.OR.some((pair) => pair.senderId === entry.senderId && pair.receiverId === entry.receiverId)) ?? null;
});

const findRequest = mock(async ({ where }: { where: { id: string } }) => requests.find((entry) => entry.id === where.id) ?? null);

const createRequest = mock(async ({ data }: { data: { id: string; senderId: string; receiverId: string } }) => {
  if (failRequestCreate) {
    failRequestCreate = false;
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
  }

  const row = { ...data, createdAt: new Date() };
  requests.push(row);
  return row;
});

const matchesRequest = (entry: RequestRow, where: RequestWhere) => {
  if (where.id !== undefined && entry.id !== where.id) return false;
  if (where.senderId !== undefined && entry.senderId !== where.senderId) return false;
  if (where.receiverId !== undefined && entry.receiverId !== where.receiverId) return false;
  return true;
};

const deleteRequests = mock(async ({ where }: { where: RequestWhere }) => {
  const hook = beforeRequestDelete;
  beforeRequestDelete = null;
  hook?.();

  const before = requests.length;
  requests = requests.filter((entry) => !matchesRequest(entry, where));
  return { count: before - requests.length };
});

const upsertFriendship = mock(async ({ where, create }: { where: FriendshipWhere; create: Omit<FriendshipRow, 'createdAt'> }) => {
  const { userAId, userBId } = where.userAId_userBId;
  const existing = friendships.find((entry) => entry.userAId === userAId && entry.userBId === userBId);
  if (existing) return existing;

  const row = { ...create, createdAt: new Date() };
  friendships.push(row);
  return row;
});

const deleteFriendship = mock(async ({ where }: { where: { id: string } }) => {
  const index = friendships.findIndex((entry) => entry.id === where.id);
  if (index === -1) throw new Error('Record not found');

  return friendships.splice(index, 1)[0];
});

const upsertChannel = mock(async ({ where, create }: { where: { dmKey: string }; create: { id: string; dmKey: string } }) => {
  const existing = channels.find((entry) => entry.dmKey === where.dmKey);
  if (existing) return existing;

  const row = { id: create.id, dmKey: create.dmKey };
  channels.push(row);
  return row;
});

const createChannelMembers = mock(async ({ data }: { data: MemberRow[] }) => {
  for (const row of data) {
    if (!members.some((entry) => entry.channelId === row.channelId && entry.userId === row.userId)) members.push(row);
  }
  return { count: data.length };
});

const prismaMock = {
  user: { findUnique: findUser },
  friendRequest: {
    findUnique: findRequest,
    findFirst: findPendingRequest,
    create: createRequest,
    deleteMany: deleteRequests,
  },
  friendship: { findUnique: findFriendship, upsert: upsertFriendship, delete: deleteFriendship },
  channel: { upsert: upsertChannel },
  channelMember: { createMany: createChannelMembers },
};

const transaction = async <T>(run: (tx: typeof prismaMock) => Promise<T>) => {
  const snapshot = {
    requests: [...requests],
    friendships: [...friendships],
    channels: [...channels],
    members: [...members],
  };

  try {
    return await run(prismaMock);
  } catch (error) {
    requests = snapshot.requests;
    friendships = snapshot.friendships;
    channels = snapshot.channels;
    members = snapshot.members;
    throw error;
  }
};

mock.module('../db', () => ({
  prisma: {
    ...prismaMock,
    $transaction: transaction,
  },
}));

const { default: friendsRoute } = await import('./friends');

const createApp = (user: UserRow) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id: user.id, username: user.username });
    c.set('session', { id: `session-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/friends', friendsRoute);

  return app;
};

const withUser = (id: string, username: string): UserRow => {
  const user = { id, username, displayName: null, avatarVersion: null };
  users.push(user);
  return user;
};

const post = (app: Hono<{ Variables: Variables }>, path: string, body: unknown) =>
  app.request(`/friends${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/friends', friendsRoute);

beforeEach(() => {
  users = [alice, bob, carol];
  requests = [];
  friendships = [];
  channels = [];
  members = [];
  failRequestCreate = false;
  beforeRequestDelete = null;
  events = [];
  stopEvents = eventBus.subscribe((event) => events.push(event));
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('returns 404 for missing users and 202 for pending and reverse requests', async () => {
  const sender = withUser('user-sender', 'sender');
  const app = createApp(sender);

  const missing = await post(app, '/sendRequest', { target: 'nobody' });
  const sent = await post(app, '/sendRequest', { target: 'bob' });
  const duplicate = await post(app, '/sendRequest', { target: 'bob' });
  const reverse = await post(createApp(bob), '/sendRequest', { target: 'sender' });

  const body = 'Friend request sent';

  expect(missing.status).toBe(404);
  expect(sent.status).toBe(202);
  expect(duplicate.status).toBe(202);
  expect(reverse.status).toBe(202);
  expect(await missing.text()).toBe('User not found');
  expect(await sent.text()).toBe(body);
  expect(await duplicate.text()).toBe(body);
  expect(await reverse.text()).toBe(body);
  expect(requests).toHaveLength(1);
  expect(requests[0]!.senderId).toBe(sender.id);
  expect(requests[0]!.receiverId).toBe(bob.id);
  expect(events).toEqual([
    {
      type: 'FRIEND_REQUEST_CREATE',
      request: { id: requests[0]!.id, createdAt: requests[0]!.createdAt.toISOString(), sender: { id: sender.id, username: 'sender', displayName: null, avatarVersion: null } },
      recipientIds: [bob.id],
    },
  ]);
});

test('returns 202 without creating a request when already friends', async () => {
  const sender = withUser('user-friend', 'friend');
  const app = createApp(sender);
  friendships.push({ id: 'friendship-1', ...friendPair(sender.id, bob.id), createdAt: new Date() });

  const response = await post(app, '/sendRequest', { target: 'bob' });

  expect(response.status).toBe(202);
  expect(requests).toEqual([]);
  expect(events).toEqual([]);
});

test('rejects self requests and invalid usernames', async () => {
  const app = createApp(alice);

  const self = await post(app, '/sendRequest', { target: 'alice' });
  const invalid = await post(app, '/sendRequest', { target: 'Not Valid!' });

  expect(self.status).toBe(400);
  expect(invalid.status).toBe(400);
  expect(requests).toEqual([]);
  expect(events).toEqual([]);
});

test('treats a unique constraint race on create as sent', async () => {
  const sender = withUser('user-race', 'race');
  failRequestCreate = true;

  const response = await post(createApp(sender), '/sendRequest', { target: 'bob' });

  expect(response.status).toBe(202);
  expect(events).toEqual([]);
});

test('requires authentication', async () => {
  for (const path of ['/sendRequest', '/respondToRequest', '/cancelRequest', '/remove']) {
    const response = await post(unauthenticated, path, {});
    expect(response.status).toBe(401);
  }
});

test('accepts a request, creates the friendship and DM, and removes the reverse request', async () => {
  const request: RequestRow = { id: 'request-1', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);
  requests.push({ id: 'request-reverse', senderId: alice.id, receiverId: bob.id, createdAt: new Date() });

  const response = await post(createApp(alice), '/respondToRequest', { requestId: request.id, accepted: true });

  expect(response.status).toBe(200);
  expect(requests).toEqual([]);
  expect(friendships).toHaveLength(1);
  expect(friendships[0]).toMatchObject({ userAId: alice.id, userBId: bob.id });
  expect(channels).toHaveLength(1);
  expect(channels[0]!.dmKey).toBe(`${alice.id}:${bob.id}`);
  expect(members).toHaveLength(2);
  expect(members.map((member) => member.userId).sort()).toEqual([alice.id, bob.id].sort());
  expect(events).toEqual([{ type: 'FRIEND_REQUEST_REMOVE', requestId: request.id, reason: 'accepted', recipientIds: [bob.id, alice.id] }]);
});

test('rejects a stale accept with 404 and changes nothing', async () => {
  const request: RequestRow = { id: 'request-stale', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);
  beforeRequestDelete = () => {
    requests = [];
  };

  const response = await post(createApp(alice), '/respondToRequest', { requestId: request.id, accepted: true });

  expect(response.status).toBe(404);
  expect(friendships).toEqual([]);
  expect(channels).toEqual([]);
  expect(members).toEqual([]);
  expect(events).toEqual([]);
});

test('gives one 200 and one 404 on a double accept', async () => {
  const request: RequestRow = { id: 'request-double', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);
  const app = createApp(alice);

  const first = await post(app, '/respondToRequest', { requestId: request.id, accepted: true });
  const second = await post(app, '/respondToRequest', { requestId: request.id, accepted: true });

  expect(first.status).toBe(200);
  expect(second.status).toBe(404);
  expect(friendships).toHaveLength(1);
  expect(events).toHaveLength(1);
});

test('rejects a request and 404s the second respond', async () => {
  const request: RequestRow = { id: 'request-reject', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);
  const app = createApp(alice);

  const first = await post(app, '/respondToRequest', { requestId: request.id, accepted: false });
  const second = await post(app, '/respondToRequest', { requestId: request.id, accepted: false });

  expect(first.status).toBe(200);
  expect(second.status).toBe(404);
  expect(requests).toEqual([]);
  expect(events).toEqual([{ type: 'FRIEND_REQUEST_REMOVE', requestId: request.id, reason: 'rejected', recipientIds: [bob.id, alice.id] }]);
});

test('hides a request from the wrong receiver', async () => {
  const request: RequestRow = { id: 'request-other', senderId: carol.id, receiverId: bob.id, createdAt: new Date() };
  requests.push(request);

  const response = await post(createApp(alice), '/respondToRequest', { requestId: request.id, accepted: true });

  expect(response.status).toBe(404);
  expect(requests).toHaveLength(1);
  expect(events).toEqual([]);
});

test('cancels only the sender request', async () => {
  const request: RequestRow = { id: 'request-cancel', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);

  const wrongSender = await post(createApp(carol), '/cancelRequest', { requestId: request.id });
  const canceled = await post(createApp(bob), '/cancelRequest', { requestId: request.id });
  const again = await post(createApp(bob), '/cancelRequest', { requestId: request.id });

  expect(wrongSender.status).toBe(404);
  expect(canceled.status).toBe(200);
  expect(again.status).toBe(404);
  expect(requests).toEqual([]);
  expect(events).toEqual([{ type: 'FRIEND_REQUEST_REMOVE', requestId: request.id, reason: 'canceled', recipientIds: [bob.id, alice.id] }]);
});

test('cannot accept a canceled request', async () => {
  const request: RequestRow = { id: 'request-gone', senderId: bob.id, receiverId: alice.id, createdAt: new Date() };
  requests.push(request);

  await post(createApp(bob), '/cancelRequest', { requestId: request.id });
  const response = await post(createApp(alice), '/respondToRequest', { requestId: request.id, accepted: true });

  expect(response.status).toBe(404);
  expect(friendships).toEqual([]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'FRIEND_REQUEST_REMOVE', reason: 'canceled' });
});

test('returns 404 when removing a non-friend', async () => {
  const response = await post(createApp(alice), '/remove', { target: 'bob' });

  expect(response.status).toBe(404);
});

test('removes a friend and keeps the DM channel and memberships', async () => {
  friendships.push({ id: 'friendship-remove', ...friendPair(alice.id, bob.id), createdAt: new Date() });
  channels.push({ id: 'channel-remove', dmKey: `${alice.id}:${bob.id}` });
  members.push({ channelId: 'channel-remove', userId: alice.id }, { channelId: 'channel-remove', userId: bob.id });

  const response = await post(createApp(alice), '/remove', { target: 'bob' });

  expect(response.status).toBe(200);
  expect(friendships).toEqual([]);
  expect(channels).toHaveLength(1);
  expect(members).toHaveLength(2);
});

test('throttles friend request sends per user', async () => {
  const sender = withUser('user-throttled', 'throttled');
  const app = createApp(sender);

  const statuses: number[] = [];
  let last: Response | undefined;

  for (let index = 0; index < 11; index++) {
    last = await post(app, '/sendRequest', { target: 'nobody' });
    statuses.push(last.status);
  }

  expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 404));
  expect(statuses[10]).toBe(429);
  expect(last!.headers.get('retry-after')).toBeTruthy();
});
