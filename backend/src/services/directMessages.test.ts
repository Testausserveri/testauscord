import { expect, test } from 'bun:test';
import { directChannelKey, friendPair } from './directMessages';

test('friend pair and DM key do not depend on argument order', () => {
  const a = '1800000000000000001';
  const b = '1800000000000000002';

  expect(friendPair(a, b)).toEqual(friendPair(b, a));
  expect(directChannelKey(a, b)).toBe(directChannelKey(b, a));
  expect(directChannelKey(a, b)).toBe(`${a}:${b}`);
});
