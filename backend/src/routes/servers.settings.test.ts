import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eventBus, type DomainEvent } from '../realtime/bus';
import type { Variables } from '../types/types';

type Member = { userId: string };
type Row = { id: string; name: string; ownerId: string; iconVersion: number | null; members: Member[] };

let servers: Row[] = [];
let updates: { id: string; name: string }[] = [];
let events: DomainEvent[] = [];
let stopEvents: (() => void) | null = null;

const findFirst = mock(async ({ where }: { where: { id: string; members?: { some: { userId: string } } } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server) return null;

  const memberId = where.members?.some.userId;
  if (memberId !== undefined && !server.members.some((member) => member.userId === memberId)) return null;

  return { id: server.id, name: server.name, ownerId: server.ownerId, iconVersion: server.iconVersion };
});

const update = mock(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
  const server = servers.find((entry) => entry.id === where.id);
  if (!server) throw new Error('Server not found');

  server.name = data.name;
  updates.push({ id: server.id, name: data.name });
  return { id: server.id, name: server.name, iconVersion: server.iconVersion };
});

const findMany = mock(async ({ where }: { where: { serverId: string } }) => servers.find((entry) => entry.id === where.serverId)?.members ?? []);

const findAccess = mock(async ({ where }: { where: { serverId: string; userId: string } }) => {
  const server = servers.find((entry) => entry.id === where.serverId);
  if (!server || !server.members.some((member) => member.userId === where.userId)) return null;

  return { server: { ownerId: server.ownerId, roles: [] }, roles: [] };
});

mock.module('../db', () => ({
  prisma: {
    server: { findFirst, update },
    serverMember: { findMany, findFirst: findAccess },
  },
}));

const { default: serversRoute } = await import('./servers');

const owner = 'user-owner';
const member = 'user-member';
const outsider = 'user-outsider';
const validator = 'user-validator';
const throttled = 'user-throttled';

const createApp = (id: string, sessionId: string) => {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((_error, c) => c.text('Internal Server Error', 500));

  app.use('*', async (c, next) => {
    c.set('user', { id, username: 'alice' });
    c.set('session', { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 60_000) });
    await next();
  });

  app.route('/servers', serversRoute);

  return app;
};

const app = createApp(owner, 'session-owner');
const memberApp = createApp(member, 'session-member');
const outsiderApp = createApp(outsider, 'session-outsider');
const validationApp = createApp(validator, 'session-validator');
const throttledApp = createApp(throttled, 'session-throttled');

const unauthenticated = new Hono<{ Variables: Variables }>();
unauthenticated.route('/servers', serversRoute);

const rename = (target: Hono<{ Variables: Variables }>, id: string, body: unknown) =>
  target.request(`/servers/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  servers = [{ id: 'server-1', name: 'Testaus', ownerId: owner, iconVersion: null, members: [{ userId: owner }, { userId: member }] }];
  updates = [];
  events = [];
  stopEvents = eventBus.subscribe((event) => events.push(event));
});

afterEach(() => {
  stopEvents?.();
  stopEvents = null;
});

afterAll(() => mock.restore());

test('renames a server and notifies every member', async () => {
  const response = await rename(app, 'server-1', { name: '  Renamed  ' });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: 'server-1', name: 'Renamed', iconVersion: null });
  expect(updates).toEqual([{ id: 'server-1', name: 'Renamed' }]);
  expect(events).toEqual([{ type: 'SERVER_UPDATED', server: { id: 'server-1', name: 'Renamed', iconVersion: null }, recipientIds: [owner, member] }]);
});

test('rejects a non-owner member', async () => {
  const response = await rename(memberApp, 'server-1', { name: 'Nope' });

  expect(response.status).toBe(403);
  expect(updates).toEqual([]);
  expect(events).toEqual([]);
});

test('hides the server from an outsider', async () => {
  const response = await rename(outsiderApp, 'server-1', { name: 'Nope' });

  expect(response.status).toBe(404);
  expect(updates).toEqual([]);
});

test('requires authentication', async () => {
  const response = await rename(unauthenticated, 'server-1', { name: 'Nope' });

  expect(response.status).toBe(401);
});

test('rejects invalid names', async () => {
  const bodies = [{ name: '' }, { name: '   ' }, { name: 'a'.repeat(101) }, {}, { name: 5 }];

  for (const body of bodies) {
    const response = await rename(validationApp, 'server-1', body);
    expect(response.status).toBe(400);
  }

  expect(updates).toEqual([]);
});

test('allows duplicate server names', async () => {
  servers.push({ id: 'server-2', name: 'Renamed', ownerId: outsider, iconVersion: null, members: [{ userId: outsider }] });

  const response = await rename(app, 'server-1', { name: 'Renamed' });

  expect(response.status).toBe(200);
  expect(updates).toEqual([{ id: 'server-1', name: 'Renamed' }]);
});

test('treats the same name as a no-op', async () => {
  const response = await rename(app, 'server-1', { name: 'Testaus' });

  expect(response.status).toBe(200);
  expect(updates).toEqual([]);
  expect(events).toEqual([]);
});

test('throttles renames per user after 10 requests', async () => {
  servers.push({ id: 'server-throttle', name: 'Before', ownerId: throttled, iconVersion: null, members: [{ userId: throttled }] });

  const statuses: number[] = [];
  let last: Response | undefined;

  for (let index = 0; index < 11; index++) {
    last = await rename(throttledApp, 'server-throttle', { name: `Rename ${index}` });
    statuses.push(last.status);
  }

  expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 200));
  expect(statuses[10]).toBe(429);
  expect(last!.headers.get('retry-after')).toBeTruthy();
});
