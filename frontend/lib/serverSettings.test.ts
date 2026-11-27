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
  expect(serverSettingsTabs(server(PERMISSIONS.VIEW_MEMBERS))).toEqual(['members']);
  expect(serverSettingsTabs(server(PERMISSIONS.KICK_MEMBERS))).toEqual(['members']);
  expect(serverSettingsTabs(server(PERMISSIONS.MANAGE_ROLES))).toEqual(['roles', 'members']);
  expect(serverSettingsTabs(server(PERMISSIONS.MANAGE_INVITES))).toEqual(['invites']);
  expect(serverSettingsTabs(server(PERMISSIONS.MANAGE_SERVER | PERMISSIONS.MANAGE_ROLES | PERMISSIONS.VIEW_MEMBERS | PERMISSIONS.MANAGE_INVITES))).toEqual(['overview', 'roles', 'members', 'invites']);
});
