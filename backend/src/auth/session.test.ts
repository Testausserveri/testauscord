import type { ServerWebSocket } from 'bun';
import { afterAll, expect, mock, test } from 'bun:test';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { addConnection } from '../realtime/connections';

const token = 'raw-session-token';
const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
const user = { id: 'user-1', username: 'alice', password: 'stored-hash' };
const row = {
  id: sessionId,
  userId: user.id,
  expiresAt: new Date(Date.now() + 60_000),
  user,
};

type StoredSession = {
  id: string;
  userId: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
};

let rows: StoredSession[] = [];

const create = mock(async (args: { data: StoredSession }) => {
  rows.push(args.data);
  return args.data;
});
const findMany = mock(async ({ where, skip }: { where: { userId: string }; skip?: number }) => {
  const found = rows.filter((stored) => stored.userId === where.userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return found.slice(skip ?? 0).map((stored) => ({ id: stored.id }));
});
const deleteMany = mock(async ({ where }: { where: { id: { in: string[] } } }) => {
  const before = rows.length;
  rows = rows.filter((stored) => !where.id.in.includes(stored.id));
  return { count: before - rows.length };
});
const transaction = async <T>(run: (tx: { session: { create: typeof create; findMany: typeof findMany; deleteMany: typeof deleteMany } }) => Promise<T>) =>
  run({ session: { create, findMany, deleteMany } });

const findUnique = mock(async ({ where }: { where: { id: string }; select?: unknown }) => (where.id === sessionId ? row : null));
const update = mock(async () => row);

mock.module('../db', () => ({
  prisma: {
    $transaction: transaction,
    session: {
      create,
      findMany,
      deleteMany,
      findUnique,
      update,
    },
  },
}));

const { createSession, MAX_SESSIONS_PER_USER, validateSessionId, validateSessionToken } = await import('./session');

afterAll(() => mock.restore());

test('stores only the token hash', async () => {
  await createSession(token, user.id);

  expect(create.mock.calls[0]?.[0].data.id).toBe(sessionId);
  expect(create.mock.calls[0]?.[0].data.id).not.toBe(token);
});

test('hashes incoming tokens before lookup', async () => {
  const result = await validateSessionToken(token);

  expect(findUnique.mock.calls[0]?.[0].where.id).toBe(sessionId);
  expect(result.user?.id).toBe(user.id);
});

test('rejects the stored hash as a token', async () => {
  const result = await validateSessionToken(sessionId);

  expect(result.user).toBeNull();
});

test('validateSessionId looks up stored ids directly', async () => {
  const result = await validateSessionId(sessionId);

  expect(result.session?.id).toBe(sessionId);
});

test('selects only the fields the request context needs', async () => {
  await validateSessionId(sessionId);

  const call = findUnique.mock.calls[findUnique.mock.calls.length - 1]?.[0];

  expect(call?.select).toEqual({
    id: true,
    userId: true,
    expiresAt: true,
    user: {
      select: {
        id: true,
        username: true,
      },
    },
  });
});

test('drops the oldest session when the per-user cap is reached', async () => {
  rows = Array.from({ length: MAX_SESSIONS_PER_USER }, (_, index) => ({
    id: `session-${index}`,
    userId: user.id,
    userAgent: null,
    createdAt: new Date(2026, 0, 1, 0, index),
    expiresAt: new Date(Date.now() + 60_000),
  }));

  const sent: string[] = [];
  const closed: number[] = [];
  const socket = {
    readyState: WebSocket.OPEN as number,
    send: (payload: string) => {
      sent.push(payload);
      return payload.length;
    },
    close: (code: number) => {
      closed.push(code);
      socket.readyState = WebSocket.CLOSED;
    },
  };

  expect(addConnection(socket as unknown as ServerWebSocket, user.id, 'session-0', Date.now() + 60_000)).toBe(true);

  await createSession('new-token', user.id);

  expect(rows).toHaveLength(MAX_SESSIONS_PER_USER);
  expect(rows.some((stored) => stored.id === 'session-0')).toBe(false);
  expect(rows.some((stored) => stored.id === 'session-1')).toBe(true);
  expect(sent.map((payload) => (JSON.parse(payload) as { type: string }).type)).toEqual(['SESSION_REVOKED']);
  expect(closed).toEqual([4001]);
});
