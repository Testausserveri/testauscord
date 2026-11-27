import { prisma } from '../db';

export const friendPair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

export const directChannelKey = (a: string, b: string): string => {
  const { userAId, userBId } = friendPair(a, b);
  return `${userAId}:${userBId}`;
};

export const canStartDm = async (viewerId: string, targetId: string): Promise<boolean> => {
  if (viewerId === targetId) return true;

  const [channel, friendship, sharedServer, target] = await Promise.all([
    prisma.channel.findUnique({
      where: { dmKey: directChannelKey(viewerId, targetId) },
      select: { id: true },
    }),
    prisma.friendship.findUnique({
      where: { userAId_userBId: friendPair(viewerId, targetId) },
      select: { id: true },
    }),
    prisma.serverMember.findFirst({
      where: {
        userId: viewerId,
        server: {
          members: { some: { userId: targetId } },
          bans: { none: { userId: { in: [viewerId, targetId] } } },
        },
      },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { id: targetId },
      select: { allowDmsFromServerMembers: true },
    }),
  ]);

  if (channel || friendship) return true;

  return Boolean(sharedServer && target?.allowDmsFromServerMembers);
};
