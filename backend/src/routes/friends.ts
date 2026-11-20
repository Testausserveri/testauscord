import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { ChannelType } from '../generated/prisma/client';
import { generateId } from '../utils/utils';
import { prisma } from '../db';
import { directChannelKey, friendPair } from '../services/directMessages';

const app = new Hono<{ Variables: Variables }>();

const isValidUsername = (value: unknown): value is string => {
  return typeof value === 'string' && value.length >= 3 && value.length <= 31 && /^[a-z0-9_-]+$/.test(value);
};

app.post('/sendRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { target } = await c.req.json();

  if (!isValidUsername(target)) {
    return c.text('Invalid username', 400);
  }

  if (target === c.get('user')!.username) {
    return c.text('You cannot send a friend request to yourself', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { username: target },
  });

  if (!targetUser) {
    return c.text('User not found', 404);
  }

  const pair = friendPair(c.get('user')!.id, targetUser.id);
  const existingFriendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: pair },
  });

  if (existingFriendship) {
    return c.text('You are already friends with this user', 409);
  }

  const pendingRequest = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId: c.get('user')!.id, receiverId: targetUser.id },
        { senderId: targetUser.id, receiverId: c.get('user')!.id },
      ],
    },
  });

  if (pendingRequest) {
    if (pendingRequest.senderId === c.get('user')!.id) {
      return c.text('You have already sent a friend request to this user', 409);
    }

    return c.text('This user has already sent you a friend request', 409);
  }

  await prisma.friendRequest.create({
    data: {
      id: generateId(),
      senderId: c.get('user')!.id,
      receiverId: targetUser.id,
    },
  });

  return c.text('Friend request sent', 201);
});

app.post('/respondToRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { requestId, accepted } = await c.req.json();

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

  if (!accepted) {
    await prisma.friendRequest.delete({
      where: { id: requestId },
    });

    return c.text('Friend request responded to', 200);
  }

  const pair = friendPair(friendRequest.senderId, friendRequest.receiverId);
  const dmKey = directChannelKey(friendRequest.senderId, friendRequest.receiverId);

  await prisma.$transaction(async (tx) => {
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
          userId: friendRequest.senderId,
        },
        {
          id: generateId(),
          channelId: channel.id,
          userId: friendRequest.receiverId,
        },
      ],
      skipDuplicates: true,
    });

    await tx.friendship.upsert({
      where: { userAId_userBId: pair },
      create: {
        id: generateId(),
        ...pair,
      },
      update: {},
    });

    await tx.friendRequest.delete({
      where: { id: requestId },
    });
  });

  return c.text('Friend request responded to', 200);
});

app.post('/cancelRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { requestId } = await c.req.json();

  if (typeof requestId !== 'string' || requestId.length === 0) {
    return c.text('Invalid request id', 400);
  }

  const friendRequest = await prisma.friendRequest.findUnique({
    where: { id: requestId },
  });

  if (!friendRequest || friendRequest.senderId !== c.get('user')!.id) {
    return c.text('Friend request not found', 404);
  }

  await prisma.friendRequest.delete({
    where: { id: requestId },
  });

  return c.text('Friend request canceled', 200);
});

app.post('/remove', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { target } = await c.req.json();

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

  const dmKey = directChannelKey(c.get('user')!.id, targetUser.id);
  const channel = await prisma.channel.findUnique({
    where: { dmKey },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.friendship.delete({
      where: { id: friendship.id },
    });

    if (channel) {
      await tx.channelMember.deleteMany({
        where: {
          channelId: channel.id,
          userId: { in: [c.get('user')!.id, targetUser.id] },
        },
      });
    }
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
        },
      },
      userB: {
        select: {
          id: true,
          username: true,
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

    return {
      id: channelId,
      channelId,
      friendshipId: entry.id,
      friendsSince: entry.createdAt,
      friend,
    };
  });

  return c.json(response);
});

export default app;
