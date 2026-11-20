import { prisma } from '../db';

export const canAccessChannel = async (userId: string, channelId: string): Promise<boolean> => {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      serverId: true,
      members: {
        where: { userId },
        select: { id: true },
      },
      server: {
        select: {
          members: {
            where: { userId },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!channel) return false;

  if (channel.serverId) return (channel.server?.members.length ?? 0) > 0;

  return channel.members.length > 0;
};
