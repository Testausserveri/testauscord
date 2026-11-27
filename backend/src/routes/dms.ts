import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { ChannelType } from '../generated/prisma/client';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { canStartDm, directChannelKey } from '../services/directMessages';
import { effectivePresence } from '../services/presence';
import { createRateLimiter } from '../utils/rateLimit';
import { generateId } from '../utils/utils';

const app = new Hono<{ Variables: Variables }>();
const dmCreateLimiter = createRateLimiter(30, 60_000);
const dmListLimiter = createRateLimiter(60, 60_000);

const userRefSelect = { id: true, username: true, displayName: true, avatarVersion: true, presenceStatus: true } as const;

const isUniqueConstraintError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
};

const ensureMembers = async (channelId: string, viewerId: string, targetId: string) => {
  await prisma.channelMember.createMany({
    data: [
      { id: generateId(), channelId, userId: viewerId, dmVisible: true },
      { id: generateId(), channelId, userId: targetId, dmVisible: false },
    ],
    skipDuplicates: true,
  });

  await prisma.channelMember.updateMany({
    where: { channelId, userId: viewerId },
    data: { dmVisible: true },
  });
};

app.post('/', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, dmCreateLimiter, viewerId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const targetId = body?.userId;

  if (typeof targetId !== 'string' || targetId.length === 0 || targetId.length > 64) {
    return c.text('Invalid user id', 400);
  }

  if (targetId === viewerId) {
    return c.text('You cannot message yourself', 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: userRefSelect,
  });

  if (!target) {
    return c.text('User not found', 404);
  }

  const dmKey = directChannelKey(viewerId, targetId);
  const existing = await prisma.channel.findUnique({
    where: { dmKey },
    select: { id: true },
  });

  if (existing) {
    await ensureMembers(existing.id, viewerId, targetId);
    return c.json({ channelId: existing.id }, 200);
  }

  if (!(await canStartDm(viewerId, targetId))) {
    return c.text('You cannot message this user', 403);
  }

  try {
    const channel = await prisma.$transaction(async (tx) => {
      const created = await tx.channel.create({
        data: { id: generateId(), type: ChannelType.DM, dmKey },
        select: { id: true, createdAt: true },
      });

      await tx.channelMember.createMany({
        data: [
          { id: generateId(), channelId: created.id, userId: viewerId, dmVisible: true },
          { id: generateId(), channelId: created.id, userId: targetId, dmVisible: false },
        ],
        skipDuplicates: true,
      });

      return created;
    });

    return c.json({ channelId: channel.id }, 201);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const raced = await prisma.channel.findUnique({
      where: { dmKey },
      select: { id: true },
    });

    if (!raced) throw error;

    await ensureMembers(raced.id, viewerId, targetId);
    return c.json({ channelId: raced.id }, 200);
  }
});

app.get('/', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, dmListLimiter, viewerId);
  if (limited) return limited;

  const channels = await prisma.channel.findMany({
    where: { type: ChannelType.DM, members: { some: { userId: viewerId, dmVisible: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      dmKey: true,
      createdAt: true,
      members: {
        where: { userId: { not: viewerId } },
        select: { user: { select: userRefSelect } },
      },
    },
  });

  const dms = channels.flatMap((channel) => {
    const user = channel.members[0]?.user;
    if (!user) return [];

    const { presenceStatus, ...ref } = user;

    return [{ channelId: channel.id, user: { ...ref, status: effectivePresence(user.id, presenceStatus) }, createdAt: channel.createdAt }];
  });

  return c.json(dms, 200);
});

export default app;
