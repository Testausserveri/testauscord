import { expect, test } from 'bun:test';
import { PERMISSIONS } from './permissions';
import { serverSettingsTabs } from './serverSettings';
import type { Server } from '@/types/types';

const server = (permissions: number): Server => ({
  id: 'server',
  name: 'Server',
  ownerId: 'owner',
  createdAt: '',
  iconVersion: null,
  channels: [],
  categories: [],
  myPermissions: permissions,
  myHighestRolePosition: 0,
});

test('tabs follow permissions', () => {
  expect(serverSettingsTabs(server(0))).toEqual([]);
  expect(serverSettingsTabs(server(PERMISSIONS.MANAGE_INVITES))).toEqual(['invites']);
  expect(serverSettingsTabs(server(PERMISSIONS.MANAGE_SERVER | PERMISSIONS.MANAGE_ROLES | PERMISSIONS.MANAGE_INVITES))).toEqual(['overview', 'roles', 'invites']);
});
