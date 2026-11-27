import { prisma } from '../db';
import type { PresenceStatus } from '../generated/prisma/client';
import type { EffectivePresence, UserRef } from '../realtime/protocol';
import { friendPair } from './directMessages';

export type ProfileRow = UserRef & { bio: string | null; presenceStatus: PresenceStatus };
export type ProfileDTO = Omit<ProfileRow, 'presenceStatus'> & { status: EffectivePresence | null };
export type AccountDTO = ProfileDTO & { presenceStatus: PresenceStatus; allowDmsFromServerMembers: boolean };

export const getUserRef = async (userId: string): Promise<UserRef | null> => {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true, avatarVersion: true },
  });
};

export const canViewUser = async (viewerId: string, targetId: string): Promise<boolean> => {
  if (viewerId === targetId) return true;

  const [friendship, sharedServer, pendingRequest] = await Promise.all([
    prisma.friendship.findUnique({
      where: { userAId_userBId: friendPair(viewerId, targetId) },
      select: { id: true },
    }),
    prisma.serverMember.findFirst({
      where: { userId: viewerId, server: { members: { some: { userId: targetId } }, bans: { none: { userId: viewerId } } } },
      select: { id: true },
    }),
    prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: viewerId, receiverId: targetId },
          { senderId: targetId, receiverId: viewerId },
        ],
      },
      select: { id: true },
    }),
  ]);

  return Boolean(friendship || sharedServer || pendingRequest);
};
