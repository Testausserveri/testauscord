import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { Variables } from '../types/types';

type Row = {
  id: string;
  userId: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
};

const userId = 'user-1';
const currentId = 'session-current';

let sessions: Row[] = [];

const matches = (session: Row, where: { id?: string; userId?: string; expiresAt?: { gt?: Date } }) => {
  if (where.id !== undefined && session.id !== where.id) return false;
  if (where.userId !== undefined && session.userId !== where.userId) return false;
  if (where.expiresAt?.gt && session.expiresAt <= where.expiresAt.gt) return false;
  return true;
};

const findMany = mock(async ({ where, orderBy }: { where?: Parameters<typeof matches>[1]; orderBy?: { createdAt?: 'asc' | 'desc' } } = {}) => {
  const result = sessions.filter((session) => matches(session, where ?? {}));
  if (orderBy?.createdAt === 'desc') result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return result;
});

const deleteMany = mock(async ({ where }: { where?: Parameters<typeof matches>[1] } = {}) => {
  const before = sessions.length;
  sessions = sessions.filter((session) => !matches(session, where ?? {}));
  return { count: before - sessions.length };
});

const initialHash = await Bun.password.hash('OldPass1!');
let passwordHash = initialHash;

const findUser = mock(async ({ where }: { where: { id: string } }) => (where.id === userId ? { password: passwordHash } : null));
const updateUser = mock(async ({ data }: { data: { password: string } }) => {
  passwordHash = data.password;
  return { id: userId };
});

mock.module('../db', () => ({
  prisma: {
    session: {
      findMany,
      deleteMany,
    },
    user: {
      findUnique: findUser,
      update: updateUser,
    },
  },
}));

const { default: account } = await import('./account');

const current = (): Row => ({
  id: currentId,
  userId,
  userAgent: 'Mozilla/5.0',
  createdAt: new Date('2026-11-24T10:00:00Z'),
  expiresAt: new Date(Date.now() + 60_000),
});

const other = (): Row => ({
  id: 'session-other',
  userId,
  userAgent: null,
  createdAt: new Date('2026-11-23T10:00:00Z'),
  expiresAt: new Date(Date.now() + 60_000),
});

const app = new Hono<{ Variables: Variables }>();

app.use('*', async (c, next) => {
  c.set('user', { id: userId, username: 'alice' });
  c.set('session', { id: currentId, userId, expiresAt: current().expiresAt });
  await next();
});

app.route('/', account);

beforeEach(() => {
  sessions = [current(), other()];
  passwordHash = initialHash;
});

afterAll(() => mock.restore());

test('lists sessions newest first and marks the current one', async () => {
  const response = await app.request('/account/sessions');
  const body = (await response.json()) as (Row & { current: boolean })[];

  expect(response.status).toBe(200);
  expect(body.map((session) => session.id)).toEqual([currentId, 'session-other']);
  expect(body.map((session) => session.current)).toEqual([true, false]);
});

test('does not revoke another user session', async () => {
  sessions.push({ ...other(), id: 'session-foreign', userId: 'user-2' });

  const response = await app.request('/account/sessions/session-foreign', { method: 'DELETE' });

  expect(response.status).toBe(404);
  expect(sessions.some((session) => session.id === 'session-foreign')).toBe(true);
});

test('revokes a single other session without touching the current one', async () => {
  const response = await app.request('/account/sessions/session-other', { method: 'DELETE' });

  expect(response.status).toBe(204);
  expect(sessions.map((session) => session.id)).toEqual([currentId]);
  expect(response.headers.get('set-cookie')).toBeNull();
});

test('revoking the current session clears the cookie', async () => {
  const response = await app.request(`/account/sessions/${currentId}`, { method: 'DELETE' });

  expect(response.status).toBe(204);
  expect(sessions).toHaveLength(1);
  expect(response.headers.get('set-cookie')).toContain('__Host-session=;');
});

test('revoking all sessions clears every session and the cookie', async () => {
  const response = await app.request('/account/sessions', { method: 'DELETE' });

  expect(response.status).toBe(204);
  expect(sessions).toHaveLength(0);
  expect(response.headers.get('set-cookie')).toContain('__Host-session=;');
});

test('changing the password revokes every session including the current one', async () => {
  const response = await app.request('/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'OldPass1!', newPassword: 'NewPass2@' }),
  });

  expect(response.status).toBe(200);
  expect(sessions).toHaveLength(0);
  expect(response.headers.get('set-cookie')).toContain('__Host-session=;');
});
