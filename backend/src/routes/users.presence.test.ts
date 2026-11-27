import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { Hono } from 'hono';
import type { PresenceStatus } from '../generated/prisma/client';
import { addConnection, removeConnection } from '../realtime/connections';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type Row = {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarVersion: number | null;
  allowDmsFromServerMembers: boolean;
  presenceStatus: PresenceStatus;
};

let user: Row;
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;

const findUser = mock(async ({ where, select }: { where: { id: string }; select?: Partial<Record<keyof Row, true>> }) => {
  if (where.id !== user.id) return null;
  if (!select) return user;

  return Object.fromEntries(Object.entries(select).map(([key]) => [key, user[key as keyof Row]]));
});

const updateUser = mock(async ({ data }: { data: { presenceStatus: PresenceStatus } }) => {
  user = { ...user, presenceStatus: data.presenceStatus };
  return { presenceStatus: user.presenceStatus };
});

const findFriendships = mock(async () => [{ userAId: user.id, userBId: 'friend' }]);
const findServerMembers = mock(async () => [{ server: { members: [{ userId: 'server-member' }], bans: [] } }]);
const findChannelMembers = mock(async () => [{ channel: { members: [{ userId: 'dm-user' }] } }]);

mock.module('../db', () => ({
  prisma: {
    user: { findUnique: findUser, update: updateUser },
    friendship: { findMany: findFriendships },
    serverMember: { findMany: findServerMembers },
    channelMember: { findMany: findChannelMembers },
  },
}));

const sockets: ServerWebSocket[] = [];

const connect = (userId: string) => {
  const socket = { readyState: WebSocket.OPEN } as ServerWebSocket;
  addConnection(socket, userId, `session-test-${userId}`, Date.now() + 60_000);
  sockets.push(socket);
};

const { default: usersRoute } = await import('./users');

const createApp = (id: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'alice' });
    c.set('session', { id: `session-${id}`, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/', usersRoute);

  return app;
};

const put = (app: Hono<{ Variables: Variables }>, body: unknown) =>
  app.request('/users/@me/presence', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  user = {
    id: 'alice',
    username: 'alice',
    displayName: 'Alice',
    bio: null,
    avatarVersion: null,
    allowDmsFromServerMembers: true,
    presenceStatus: 'ONLINE',
  };
  events = [];
  stopEvents = eventBus.subscribe((event) => events.push(event));
  connect('alice');
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;

  for (const socket of sockets) removeConnection(socket);
  sockets.length = 0;
});

afterAll(() => mock.restore());

test('updates the status and publishes to recipients and the user', async () => {
  const response = await put(createApp('alice'), { status: 'DND' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ presenceStatus: 'DND' });
  expect(user.presenceStatus).toBe('DND');
  expect(events).toEqual([
    {
      type: 'PRESENCE_UPDATE',
      userId: 'alice',
      status: 'DND',
      recipientIds: ['friend', 'server-member', 'dm-user'],
    },
    { type: 'PRESENCE_SELF_UPDATE', userId: 'alice', presenceStatus: 'DND' },
  ]);
});

test('stores invisible and reports it only on the self profile', async () => {
  const updated = await put(createApp('alice'), { status: 'INVISIBLE' });
  expect(updated.status).toBe(200);
  expect(user.presenceStatus).toBe('INVISIBLE');

  const response = await createApp('alice').request('/users/@me');
  const body = (await response.json()) as { presenceStatus: string; status: string };

  expect(response.status).toBe(200);
  expect(body.presenceStatus).toBe('INVISIBLE');
  expect(body.status).toBe('OFFLINE');
});

test('rejects an invalid status', async () => {
  const response = await put(createApp('alice'), { status: 'AWAY' });

  expect(response.status).toBe(400);
  expect(user.presenceStatus).toBe('ONLINE');
  expect(events).toEqual([]);
});

test('throttles presence updates per user after 60 requests', async () => {
  const app = createApp('presence-throttle');
  const statuses: number[] = [];
  let last: Response | undefined;

  for (let index = 0; index < 61; index++) {
    last = await put(app, { status: 'IDLE' });
    statuses.push(last.status);
  }

  expect(statuses.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => 200));
  expect(statuses[60]).toBe(429);
  expect(last!.headers.get('retry-after')).toBeTruthy();
});
