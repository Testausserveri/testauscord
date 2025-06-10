import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import type { Variables } from '../types/types';
import { FriendRequestStatus } from '@prisma/client';
import { generateId } from '../utils/utils';

const prisma = new PrismaClient();
const app = new Hono<{ Variables: Variables }>();

app.post('/sendRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { target } = await c.req.json();

  if (typeof target !== 'string' || target.length < 3 || target.length > 31 || !/^[a-z0-9_-]+$/.test(target)) {
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

  const existingFriendship = await prisma.friendRequest.findUnique({
    where: {
      senderId_receiverId: {
        senderId: c.get('user')!.id,
        receiverId: targetUser.id,
      },
    },
  });

  if (existingFriendship && existingFriendship.status === FriendRequestStatus.PENDING) {
    return c.text('You have already sent a friend request to this user', 409);
  }

  if (existingFriendship && existingFriendship.status === FriendRequestStatus.ACCEPTED) {
    return c.text('You are already friends with this user', 409);
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

  if (typeof requestId !== 'string' || /^\d+$/.test(requestId) === false) {
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

  if (friendRequest.status !== FriendRequestStatus.PENDING) {
    return c.text('Friend request has already been responded to', 409);
  }

  if (accepted !== true) {
    await prisma.friendRequest.delete({
      where: { id: requestId },
    });
  } else if (accepted === true) {
    await prisma.friendRequest.update({
      where: { id: requestId },
      data: {
        status: FriendRequestStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });

    await prisma.channel.create({
      data: {
        id: friendRequest.id,
      },
    });

    await prisma.channelMember.createMany({
      data: [
        { id: generateId(), channelId: friendRequest.id, userId: friendRequest.senderId },
        { id: generateId(), channelId: friendRequest.id, userId: friendRequest.receiverId },
      ],
      skipDuplicates: true,
    });
  }

  return c.text('Friend request responded to', 200);
});

app.post('/cancelRequest', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const { requestId } = await c.req.json();

  if (typeof requestId !== 'string' || /^\d+$/.test(requestId) === false) {
    return c.text('Invalid request id', 400);
  }

  const friendRequest = await prisma.friendRequest.findUnique({
    where: { id: requestId },
  });

  if (!friendRequest || friendRequest.senderId !== c.get('user')!.id) {
    return c.text('Friend request not found', 404);
  }

  if (friendRequest.status !== FriendRequestStatus.PENDING) {
    return c.text('Friend request has already been accepted', 409);
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

  if (typeof target !== 'string' || target.length < 3 || target.length > 31 || !/^[a-z0-9_-]+$/.test(target)) {
    return c.text('Invalid username', 400);
  }

  const targetUser = await prisma.user.findUnique({
    where: { username: target },
    select: {
      id: true,
    },
  });

  if (!targetUser) {
    return c.text('User not found', 404);
  }

  const existingFriendship = await prisma.friendRequest.findFirst({
    where: {
      OR: [
        { senderId: c.get('user')!.id, receiverId: targetUser.id },
        { senderId: targetUser.id, receiverId: c.get('user')!.id },
      ],
      status: 'ACCEPTED',
    },
  });

  if (!existingFriendship) {
    return c.text('You are not friends with this user', 404);
  }

  await prisma.friendRequest.deleteMany({
    where: { id: existingFriendship.id },
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
      status: FriendRequestStatus.PENDING,
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
      status: FriendRequestStatus.PENDING,
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

  const friends = await prisma.friendRequest.findMany({
    where: {
      OR: [
        { senderId: c.get('user')!.id, status: FriendRequestStatus.ACCEPTED },
        { receiverId: c.get('user')!.id, status: FriendRequestStatus.ACCEPTED },
      ],
    },
    select: {
      id: true,
      acceptedAt: true,
      sender: {
        select: {
          id: true,
          username: true,
        },
      },
      receiver: {
        select: {
          id: true,
          username: true,
        },
      },
    },
  });

  const response = friends.map((entry) => {
    const friend = entry.sender.id === c.get('user')!.id ? entry.receiver : entry.sender;

    return {
      id: entry.id,
      friendsSince: entry.acceptedAt,
      friend,
    };
  });

  return c.json(response);
});

export default app;
