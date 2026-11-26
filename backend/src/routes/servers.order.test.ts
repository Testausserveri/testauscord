import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type Membership = { id: string; serverId: string; userId: string; position: number };

let memberships: Membership[] = [];
let updates: { id: string; position: number }[] = [];

const findMany = mock(async ({ where }: { where: { userId: string; server: { bans: { none: { userId: string } } } } }) => {
  return memberships.filter((membership) => membership.userId === where.userId).map((membership) => ({ id: membership.id, serverId: membership.serverId }));
});

const update = mock(async ({ where, data }: { where: { id: string }; data: { position: number } }) => {
  const membership = memberships.find((entry) => entry.id === where.id);
  if (membership) membership.position = data.position;
  updates.push({ id: where.id, position: data.position });
  return membership;
});

mock.module('../db', () => ({
  prisma: {
    serverMember: { findMany, update },
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

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/servers', serversRoute);

const reorder = (app: Hono<{ Variables: Variables }>, serverIds: unknown) =>
  app.request('/servers/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverIds }) });

const seed = (userId: string, count: number) => {
  for (let index = 0; index < count; index++) {
    memberships.push({ id: `membership-${userId}-${index}`, serverId: `server-${userId}-${index}`, userId, position: index });
  }
};

beforeEach(() => {
  memberships = [];
  updates = [];
  findMany.mockClear();
  update.mockClear();
});

afterAll(() => mock.restore());

test('requires authentication', async () => {
  expect((await reorder(unauthenticated, [])).status).toBe(401);
});

test('accepts the exact set in any order', async () => {
  seed('user-exact', 3);

  const response = await reorder(createApp('user-exact'), ['server-user-exact-2', 'server-user-exact-1', 'server-user-exact-0']);

  expect(response.status).toBe(204);
  expect(findMany.mock.calls[0]?.[0].where).toEqual({ userId: 'user-exact', server: { bans: { none: { userId: 'user-exact' } } } });
  expect(updates).toEqual([
    { id: 'membership-user-exact-2', position: 0 },
    { id: 'membership-user-exact-1', position: 1 },
    { id: 'membership-user-exact-0', position: 2 },
  ]);
});

test('accepts an empty list for a user without servers', async () => {
  const response = await reorder(createApp('user-empty'), []);

  expect(response.status).toBe(204);
  expect(updates).toEqual([]);
});

test('rejects duplicates', async () => {
  seed('user-duplicate', 1);

  const response = await reorder(createApp('user-duplicate'), ['server-user-duplicate-0', 'server-user-duplicate-0']);

  expect(response.status).toBe(400);
  expect(await response.text()).toBe('Invalid server order');
  expect(updates).toEqual([]);
});

test('rejects a foreign server id', async () => {
  seed('user-foreign-a', 1);
  seed('user-foreign-b', 1);

  const response = await reorder(createApp('user-foreign-a'), ['server-user-foreign-b-0']);

  expect(response.status).toBe(400);
  expect(updates).toEqual([]);
});

test('rejects a missing server id', async () => {
  seed('user-missing', 2);

  const response = await reorder(createApp('user-missing'), ['server-user-missing-0']);

  expect(response.status).toBe(400);
  expect(updates).toEqual([]);
});

test('rejects invalid bodies', async () => {
  const app = createApp('user-invalid');

  const bodies = [{}, { serverIds: 'nope' }, { serverIds: [''] }, { serverIds: Array.from({ length: 201 }, (_value, index) => `server-${index}`) }];

  for (const body of bodies) {
    const response = await app.request('/servers/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(400);
  }
});

test('throttles reorders per user after 60 requests', async () => {
  const app = createApp('user-order-throttle');
  const statuses: number[] = [];

  for (let index = 0; index < 61; index++) {
    statuses.push((await reorder(app, [])).status);
  }

  expect(statuses.slice(0, 60)).toEqual(Array.from({ length: 60 }, () => 204));
  expect(statuses[60]).toBe(429);
});
