import { prisma } from '../db';

export const canAccessChannel = async (userId: string, channelId: string): Promise<boolean> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      members: {
        where: { userId },
        select: { id: true },
      },
    },
  });

  return channel !== null && channel.members.length > 0;
};
