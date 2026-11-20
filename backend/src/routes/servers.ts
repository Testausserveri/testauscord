import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db';
import type { Variables } from '../types/types';
import { generateId } from '../utils/utils';

const app = new Hono<{ Variables: Variables }>();

const serverNameSchema = z.string().trim().min(1).max(100);
const channelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, 'Invalid channel name');

const serverSelect = {
  id: true,
  name: true,
  ownerId: true,
  createdAt: true,
  channels: {
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: 'asc' },
  },
} as const;

const isUniqueConstraintError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
};

app.post('/', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: serverNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid server name', 400);
  }

  const server = await prisma.server.create({
    data: {
      id: generateId(),
      name: result.data.name,
      ownerId: c.get('user')!.id,
      members: {
        create: { id: generateId(), userId: c.get('user')!.id },
      },
      channels: {
        create: { id: generateId(), name: 'general', type: 'TEXT' },
      },
    },
    select: serverSelect,
  });

  return c.json(server, 201);
});

app.get('/', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const servers = await prisma.server.findMany({
    where: { members: { some: { userId: c.get('user')!.id } } },
    select: serverSelect,
    orderBy: { createdAt: 'asc' },
  });

  return c.json(servers, 200);
});

app.get('/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId: c.get('user')!.id } } },
    select: {
      ...serverSelect,
      members: {
        select: {
          joinedAt: true,
          user: { select: { id: true, username: true } },
        },
        orderBy: { joinedAt: 'asc' },
      },
    },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  return c.json(
    {
      ...server,
      members: server.members.map((member) => ({
        id: member.user.id,
        username: member.user.username,
        joinedAt: member.joinedAt,
      })),
    },
    200,
  );
});

app.post('/:id/channels', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findUnique({
    where: { id: c.req.param('id') },
    select: { ownerId: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (server.ownerId !== c.get('user')!.id) {
    return c.text('Only the server owner can create channels', 403);
  }

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: channelNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid channel name', 400);
  }

  try {
    const channel = await prisma.channel.create({
      data: {
        id: generateId(),
        serverId: c.req.param('id'),
        name: result.data.name,
        type: 'TEXT',
      },
      select: { id: true, name: true, type: true },
    });

    return c.json(channel, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Channel name already in use', 409);
    }
    throw error;
  }
});

export default app;
