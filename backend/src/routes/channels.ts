import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import type { Variables } from '../types/types';

const prisma = new PrismaClient();
const app = new Hono<{ Variables: Variables }>();

app.get('/:id/messages', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  if (!c.req.param('id')) {
    return c.text('Invalid channel id', 400);
  }

  const channel = await prisma.channel.findUnique({
    where: { id: c.req.param('id') },
    select: {
      id: true,
      name: true,
      members: true,
      messages: {
        select: {
          id: true,
          createdAt: true,
          content: true,
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
    },
  });

  if (!channel) {
    return c.text('Channel not found', 404);
  }

  if (!channel.members.some((member) => member.userId === c.get('user')!.id)) {
    return c.text('You do not have permission to view this channel', 403);
  }

  if (c.req.query('limit') && !/^\d+$/.test(c.req.query('limit')!)) {
    return c.text('Invalid limit', 400);
  }

  if (c.req.query('before') && !/^\d{9}$/.test(c.req.query('before')!)) {
    return c.text('Invalid before', 400);
  }

  let messages = [...channel.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (c.req.query('before')) {
    messages = messages.slice(
      0,
      messages.findIndex((message) => message.id === c.req.query('before'))
    );
  }

  if (c.req.query('limit')) {
    return c.json(messages.slice(-Number(c.req.query('limit'))), 200);
  }

  return c.json(messages, 200);
});

export default app;
