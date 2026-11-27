import { PERMISSIONS, hasPermission } from './permissions';
import type { Server } from '@/types/types';

export type ServerSettingsTab = 'overview' | 'roles' | 'invites';

export const serverSettingsTabs = (server: Server): ServerSettingsTab[] => {
  const tabs: ServerSettingsTab[] = [];
  if (hasPermission(server, PERMISSIONS.MANAGE_SERVER)) tabs.push('overview');
  if (hasPermission(server, PERMISSIONS.MANAGE_ROLES)) tabs.push('roles');
  if (hasPermission(server, PERMISSIONS.MANAGE_INVITES)) tabs.push('invites');
  return tabs;
};
