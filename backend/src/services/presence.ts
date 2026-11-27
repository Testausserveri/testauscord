import { prisma } from '../db';
import { ChannelType, type PresenceStatus } from '../generated/prisma/client';
import { eventBus } from '../realtime/bus';
import { isUserConnected } from '../realtime/connections';
import type { EffectivePresence } from '../realtime/protocol';

export type { EffectivePresence };

export const effectivePresence = (userId: string, stored: PresenceStatus): EffectivePresence => {
  if (stored === 'INVISIBLE' || !isUserConnected(userId)) return 'OFFLINE';
  return stored;
};

export const presenceRecipientIds = async (userId: string): Promise<string[]> => {
  const [friendships, memberships, dmMemberships] = await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    }),
    prisma.serverMember.findMany({
      where: { userId, server: { bans: { none: { userId } } } },
      select: {
        server: {
          select: {
            members: { where: { userId: { not: userId } }, select: { userId: true } },
            bans: { select: { userId: true } },
          },
        },
      },
    }),
    prisma.channelMember.findMany({
      where: { userId, channel: { type: ChannelType.DM } },
      select: {
        channel: {
          select: {
            members: { where: { userId: { not: userId } }, select: { userId: true } },
          },
        },
      },
    }),
  ]);

  const recipientIds = new Set<string>();

  for (const friendship of friendships) {
    recipientIds.add(friendship.userAId === userId ? friendship.userBId : friendship.userAId);
  }

  for (const membership of memberships) {
    const banned = new Set(membership.server.bans.map((ban) => ban.userId));
    for (const member of membership.server.members) {
      if (!banned.has(member.userId)) recipientIds.add(member.userId);
    }
  }

  for (const dm of dmMemberships) {
    for (const member of dm.channel.members) recipientIds.add(member.userId);
  }

  recipientIds.delete(userId);

  return [...recipientIds];
};

export const canViewPresence = async (viewerId: string, targetId: string): Promise<boolean> => {
  if (viewerId === targetId) return true;

  return (await presenceRecipientIds(viewerId)).includes(targetId);
};

export const publishPresence = async (userId: string): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { presenceStatus: true },
  });

  if (!user) return;

  const recipientIds = await presenceRecipientIds(userId);

  eventBus.publish({
    type: 'PRESENCE_UPDATE',
    userId,
    status: effectivePresence(userId, user.presenceStatus),
    recipientIds,
  });
};
