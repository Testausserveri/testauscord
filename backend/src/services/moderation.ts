import { prisma } from '../db';

export const getBan = async (serverId: string, userId: string) => {
  return prisma.serverBan.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { id: true },
  });
};
