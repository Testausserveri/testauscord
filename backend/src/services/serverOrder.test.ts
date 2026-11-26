import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

let last: { position: number } | null = null;
let lastArgs: unknown = null;

const findFirst = mock(async (args: unknown) => {
  lastArgs = args;
  return last;
});

mock.module('../db', () => ({
  prisma: { serverMember: { findFirst } },
}));

const { nextServerPosition } = await import('./serverOrder');

afterAll(() => mock.restore());

beforeEach(() => {
  last = null;
  lastArgs = null;
  findFirst.mockClear();
});

test('starts at 0 for a user without servers', async () => {
  expect(await nextServerPosition('user-empty')).toBe(0);
  expect(lastArgs).toEqual({ where: { userId: 'user-empty' }, select: { position: true }, orderBy: { position: 'desc' } });
});

test('appends after the highest position', async () => {
  last = { position: 4 };

  expect(await nextServerPosition('user-busy')).toBe(5);
});
