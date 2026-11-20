import { Hono } from 'hono';
import { z } from 'zod';
import type { Variables } from '../types/types';
import { prisma } from '../db';
import { canAccessChannel } from '../services/access';
import { createChannelMessage } from '../services/messages';

const app = new Hono<{ Variables: Variables }>();

const createMessageSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(4000)
    .refine((value) => value.trim().length > 0),
  nonce: z.string().min(1).max(64),
});

app.post('/:id/messages', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const channelId = c.req.param('id');
  if (!channelId) {
    return c.text('Invalid channel id', 400);
  }

  const body = await c.req.json().catch(() => null);
  const result = createMessageSchema.safeParse(body);

  if (!result.success) {
    return c.text('Invalid message', 400);
  }

  if (!(await canAccessChannel(c.get('user')!.id, channelId))) {
    return c.text('You do not have permission to send messages in this channel', 403);
  }

  const { message, created } = await createChannelMessage({
    channelId,
    senderId: c.get('user')!.id,
    content: result.data.content,
    clientNonce: result.data.nonce,
  });

  return c.json(message, created ? 201 : 200);
});

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
          channelId: true,
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

  let messages = [...channel.messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (c.req.query('before')) {
    const index = messages.findIndex((message) => message.id === c.req.query('before'));

    if (index === -1) {
      return c.text('Invalid before', 400);
    }

    messages = messages.slice(0, index);
  }

  if (c.req.query('limit')) {
    return c.json(messages.slice(-Number(c.req.query('limit'))), 200);
  }

  return c.json(messages, 200);
});

export default app;
