import { prisma } from '../db';

export const nextServerPosition = async (userId: string): Promise<number> => {
  const last = await prisma.serverMember.findFirst({
    where: { userId },
    select: { position: true },
    orderBy: { position: 'desc' },
  });

  return (last?.position ?? -1) + 1;
};
