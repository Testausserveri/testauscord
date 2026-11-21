import { afterAll, expect, mock, test } from 'bun:test';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeHexLowerCase } from '@oslojs/encoding';

const token = 'raw-session-token';
const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
const user = { id: 'user-1', username: 'alice', password: 'stored-hash' };
const row = {
  id: sessionId,
  userId: user.id,
  expiresAt: new Date(Date.now() + 60_000),
  user,
};

const findUnique = mock(async ({ where }: { where: { id: string } }) => (where.id === sessionId ? row : null));
const create = mock(async (args: { data: { id: string } }) => args.data);
const update = mock(async () => row);

mock.module('../db', () => ({
  prisma: {
    session: {
      create,
      findUnique,
      update,
    },
  },
}));

const { createSession, validateSessionId, validateSessionToken } = await import('./session');

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
