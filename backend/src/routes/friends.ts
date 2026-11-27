import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { ChannelType } from '../generated/prisma/client';
import { enforceRateLimit } from '../middleware/rateLimit';
import { createRateLimiter } from '../utils/rateLimit';
import { generateId } from '../utils/utils';
import { prisma } from '../db';
import { eventBus } from '../realtime/bus';
import { directChannelKey, friendPair } from '../services/directMessages';
import { effectivePresence } from '../services/presence';
import { getUserRef } from '../services/profiles';

const app = new Hono<{ Variables: Variables }>();
const friendRequestLimiter = createRateLimiter(10, 60 * 60_000);
const friendMutationLimiter = createRateLimiter(60, 60_000);
const friendRequestResponse = 'Friend request sent';

const isUniqueConstraintError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
};

const isValidUsername = (value: unknown): value is string => {
  return typeof value === 'string' && value.length >= 3 && value.length <= 31 && /^[a-z0-9_-]+$/.test(value);
};

app.post('/sendRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, friendRequestLimiter, c.get('user')!.id);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const target = body?.target;

  if (!isValidUsername(target)) {
    return c.text('Invalid username', 400);
  }

  if (target === c.get('user')!.username) {
    return c.text('You cannot send a friend request to yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { username: target },
    select: { id: true },
  });

  if (!targetUser) {
    return c.text('User not found', 404);
  }

  const pair = friendPair(c.get('user')!.id, targetUser.id);
  const existingFriendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
    select: { id: true },
  });

  if (existingFriendship) {
    return c.text(friendRequestResponse, 202);
  }

  const pendingRequest = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId: c.get('user')!.id, receiverId: targetUser.id },
        { senderId: targetUser.id, receiverId: c.get('user')!.id },
      ],
    },
    select: { id: true },
  });

  if (pendingRequest) {
    return c.text(friendRequestResponse, 202);
  }

  try {
    const request = await prisma.friendRequest.create({
      data: {
        id: generateId(),
        senderId: c.get('user')!.id,
        receiverId: targetUser.id,
      },
    });

    const sender = await getUserRef(c.get('user')!.id);

    if (sender) {
      eventBus.publish({
        type: 'FRIEND_REQUEST_CREATE',
        request: { id: request.id, createdAt: request.createdAt.toISOString(), sender },
        recipientIds: [targetUser.id],
      });
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  return c.text(friendRequestResponse, 202);
});

app.post('/respondToRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, friendMutationLimiter, c.get('user')!.id);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const requestId = body?.requestId;
  const accepted = body?.accepted;

  if (typeof requestId !== 'string' || requestId.length === 0) {
    return c.text('Invalid request id', 400);
  }

  if (typeof accepted !== 'boolean') {
    return c.text('Invalid accepted value', 400);
  }

  const friendRequest = await prisma.friendRequest.findUnique({
    where: { id: requestId },
  });

  if (!friendRequest || friendRequest.receiverId !== c.get('user')!.id) {
    return c.text('Friend request not found', 404);
  }

  const receiverId = c.get('user')!.id;

  if (!accepted) {
    const { count } = await prisma.friendRequest.deleteMany({
      where: { id: requestId, receiverId },
    });

    if (count === 0) {
      return c.text('Friend request not found', 404);
    }

    eventBus.publish({
      type: 'FRIEND_REQUEST_REMOVE',
      requestId,
      reason: 'rejected',
      recipientIds: [friendRequest.senderId, receiverId],
    });

    return c.text('Friend request responded to', 200);
  }

  const { senderId } = friendRequest;
  const pair = friendPair(senderId, receiverId);
  const dmKey = directChannelKey(senderId, receiverId);

  const handled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.friendRequest.deleteMany({
      where: { id: requestId, receiverId },
    });

    if (count === 0) return false;

    await tx.friendRequest.deleteMany({
      where: { senderId: receiverId, receiverId: senderId },
    });

    const channel = await tx.channel.upsert({
      where: { dmKey },
      create: {
        id: generateId(),
        type: ChannelType.DM,
        dmKey,
      },
      update: {},
    });

    await tx.channelMember.createMany({
      data: [
        {
          id: generateId(),
          channelId: channel.id,
          userId: senderId,
        },
        {
          id: generateId(),
          channelId: channel.id,
          userId: receiverId,
        },
      ],
      skipDuplicates: true,
    });

    await tx.channelMember.updateMany({
      where: { channelId: channel.id },
      data: { dmVisible: true },
    });

    await tx.friendship.upsert({
      where: { userAId_userBId: pair },
      create: {
        id: generateId(),
        ...pair,
      },
      update: {},
    });

    return true;
  });

  if (!handled) {
    return c.text('Friend request not found', 404);
  }

  eventBus.publish({
    type: 'FRIEND_REQUEST_REMOVE',
    requestId,
    reason: 'accepted',
    recipientIds: [senderId, receiverId],
  });

  return c.text('Friend request responded to', 200);
});

app.post('/cancelRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, friendMutationLimiter, c.get('user')!.id);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const requestId = body?.requestId;

  if (typeof requestId !== 'string' || requestId.length === 0) {
    return c.text('Invalid request id', 400);
  }

  const receiverId = c.get('user')!.id;
  const friendRequest = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    select: { senderId: true, receiverId: true },
  });

  if (!friendRequest || friendRequest.senderId !== receiverId) {
    return c.text('Friend request not found', 404);
  }

  const { count } = await prisma.friendRequest.deleteMany({
    where: { id: requestId, senderId: receiverId },
  });

  if (count === 0) {
    return c.text('Friend request not found', 404);
  }

  eventBus.publish({
    type: 'FRIEND_REQUEST_REMOVE',
    requestId,
    reason: 'canceled',
    recipientIds: [friendRequest.senderId, friendRequest.receiverId],
  });

  return c.text('Friend request canceled', 200);
});

app.post('/remove', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, friendMutationLimiter, c.get('user')!.id);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const target = body?.target;

  if (!isValidUsername(target)) {
    return c.text('Invalid username', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { username: target },
    select: { id: true },
  });

  if (!targetUser) {
    return c.text('User not found', 404);
  }

  const pair = friendPair(c.get('user')!.id, targetUser.id);
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
  });

  if (!friendship) {
    return c.text('You are not friends with this user', 404);
  }

  await prisma.friendship.delete({
    where: { id: friendship.id },
  });

  return c.text('Friend removed', 200);
});

app.get('/pendingRequests', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const requests = await prisma.friendRequest.findMany({
    where: {
      receiverId: c.get('user')!.id,
    },
    select: {
      id: true,
      createdAt: true,
      sender: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarVersion: true,
        },
      },
    },
  });

  return c.json(requests);
});

app.get('/sentRequests', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const requests = await prisma.friendRequest.findMany({
    where: {
      senderId: c.get('user')!.id,
    },
    select: {
      id: true,
      createdAt: true,
      receiver: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarVersion: true,
        },
      },
    },
  });

  return c.json(requests);
});

app.get('/', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [{ userAId: c.get('user')!.id }, { userBId: c.get('user')!.id }],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      createdAt: true,
      userA: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarVersion: true,
          presenceStatus: true,
        },
      },
      userB: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarVersion: true,
          presenceStatus: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const dmKeys = friendships.map((entry) => directChannelKey(entry.userAId, entry.userBId));
  const channels = await prisma.channel.findMany({
    where: { dmKey: { in: dmKeys } },
    select: { id: true, dmKey: true },
  });

  const channelByKey = new Map<string, string>();
  for (const channel of channels) {
    if (channel.dmKey) channelByKey.set(channel.dmKey, channel.id);
  }

  const response = friendships.map((entry) => {
    const friend = entry.userAId === c.get('user')!.id ? entry.userB : entry.userA;
    const channelId = channelByKey.get(directChannelKey(entry.userAId, entry.userBId)) ?? '';
    const { presenceStatus, ...ref } = friend;

    return {
      id: channelId,
      channelId,
      friendshipId: entry.id,
      friendsSince: entry.createdAt,
      friend: { ...ref, status: effectivePresence(friend.id, presenceStatus) },
    };
  });

  return c.json(response);
});

export default app;
