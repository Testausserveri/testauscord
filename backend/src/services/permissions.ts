import { prisma } from '../db';

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

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((all, bit) => all | bit, 0);

export type MemberAccess = {
  isMember: boolean;
  isOwner: boolean;
  permissions: number;
  highestPosition: number;
};

export const getMemberAccess = async (serverId: string, userId: string): Promise<MemberAccess | null> => {
  const member = await prisma.serverMember.findFirst({
    where: { serverId, userId, server: { bans: { none: { userId } } } },
    select: {
      server: {
        select: {
          ownerId: true,
          roles: { where: { isDefault: true }, select: { permissions: true } },
        },
      },
      roles: { select: { role: { select: { permissions: true, position: true } } } },
    },
  });

  if (!member) return null;

  if (member.server.ownerId === userId) {
    return { isMember: true, isOwner: true, permissions: ALL_PERMISSIONS, highestPosition: 1_000_000 };
  }

  const permissions = member.roles.reduce((bits, entry) => bits | entry.role.permissions, member.server.roles[0]?.permissions ?? 0);
  const highestPosition = member.roles.reduce((highest, entry) => Math.max(highest, entry.role.position), 0);

  return { isMember: true, isOwner: false, permissions, highestPosition };
};

export const hasPermission = (access: MemberAccess, bit: number) => (access.permissions & bit) === bit;

export const hasUnknownPermissionBits = (permissions: number) => (permissions & ~ALL_PERMISSIONS) !== 0;

export const requirePermission = async (serverId: string, userId: string, bit: number): Promise<MemberAccess | Response> => {
  const access = await getMemberAccess(serverId, userId);

  if (!access) return new Response('Server not found', { status: 404 });
  if (!hasPermission(access, bit)) return new Response('Forbidden', { status: 403 });

  return access;
};
