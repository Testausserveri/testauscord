import { expect, test } from 'bun:test';
import { moveRoleOrder, parseRoleColor, roleColorHex } from './roles';
import type { ServerRole } from '@/types/types';

const role = (id: string, position: number, isDefault = false): ServerRole => ({ id, name: id, color: null, permissions: 0, position, isDefault });

test('moves a role and returns ids in ascending position order', () => {
  const roles = [role('a', 3), role('b', 2), role('c', 1), role('everyone', 0, true)];

  expect(moveRoleOrder(roles, 'c', -1)).toEqual(['b', 'c', 'a']);
  expect(moveRoleOrder(roles, 'a', 1)).toEqual(['c', 'a', 'b']);
  expect(moveRoleOrder(roles, 'a', -1)).toBeNull();
  expect(moveRoleOrder(roles, 'c', 1)).toBeNull();
  expect(moveRoleOrder(roles, 'everyone', -1)).toBeNull();
});

test('parses role colors', () => {
  expect(parseRoleColor('#5865F2')).toBe(0x5865f2);
  expect(parseRoleColor('5865f2')).toBe(0x5865f2);
  expect(parseRoleColor('')).toBeNull();
  expect(parseRoleColor('#fff')).toBeUndefined();
  expect(roleColorHex(0x5865f2)).toBe('#5865f2');
});
