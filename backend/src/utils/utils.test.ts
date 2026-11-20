import { expect, test } from 'bun:test';
import { generateId } from './utils';

test('generates unique numeric snowflake ids in increasing order', () => {
  const first = generateId();
  const second = generateId();

  expect(first).toMatch(/^\d+$/);
  expect(second).toMatch(/^\d+$/);
  expect(second).not.toBe(first);
  expect(BigInt(second) > BigInt(first)).toBe(true);
});
