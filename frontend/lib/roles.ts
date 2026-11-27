import type { ServerRole } from '@/types/types';

export const roleColorHex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

export const parseRoleColor = (value: string) => {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const match = /^#?([0-9a-f]{6})$/i.exec(trimmed);
  return match ? Number.parseInt(match[1], 16) : undefined;
};

export const moveRoleOrder = (roles: ServerRole[], roleId: string, direction: -1 | 1) => {
  const ordered = roles.filter((role) => !role.isDefault).sort((a, b) => b.position - a.position);
  const index = ordered.findIndex((role) => role.id === roleId);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= ordered.length) return null;

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.reverse().map((role) => role.id);
};
