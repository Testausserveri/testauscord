import { expect, test } from 'bun:test';
import { createInviteCode } from './servers';

test('invite codes are 8 alphanumeric characters and unique', () => {
  const codes = Array.from({ length: 100 }, () => createInviteCode());

  for (const code of codes) {
    expect(code).toMatch(/^[a-zA-Z0-9]{8}$/);
  }

  expect(new Set(codes).size).toBe(codes.length);
});
