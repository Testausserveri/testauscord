import { prisma } from '../db';
import { friendPair } from './directMessages';

export const canViewUser = async (viewerId: string, targetId: string): Promise<boolean> => {
  if (viewerId === targetId) return true;

  const [friendship, sharedServer, pendingRequest] = await Promise.all([
    prisma.friendship.findUnique({
      where: { userAId_userBId: friendPair(viewerId, targetId) },
      select: { id: true },
    }),
    prisma.serverMember.findFirst({
      where: { userId: viewerId, server: { members: { some: { userId: targetId } } } },
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
