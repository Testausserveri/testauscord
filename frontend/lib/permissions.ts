export const PERMISSIONS = {
  MANAGE_SERVER: 1 << 0,
  MANAGE_ROLES: 1 << 1,
  MANAGE_CHANNELS: 1 << 2,
  KICK_MEMBERS: 1 << 3,
  BAN_MEMBERS: 1 << 4,
  MANAGE_INVITES: 1 << 5,
  VIEW_AUDIT_LOG: 1 << 6,
  VIEW_MEMBERS: 1 << 7,
} as const;

export const hasPermission = (server: { myPermissions: number }, bit: number) => (server.myPermissions & bit) === bit;
