import { Hono } from 'hono';
import { z } from 'zod';
import type { Variables } from '../types/types';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { canAccessChannel } from '../services/access';
import { buildMessagePage, createChannelMessage, toMessageDto } from '../services/messages';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono<{ Variables: Variables }>();
const messageLimiter = createRateLimiter(10, 5_000);

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

  const limited = enforceRateLimit(c, messageLimiter, c.get('user')!.id);
  if (limited) return limited;

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

  const channelId = c.req.param('id');
  if (!channelId) {
    return c.text('Invalid channel id', 400);
  }

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true },
  });

  if (!channel) {
    return c.text('Channel not found', 404);
  }

  if (!(await canAccessChannel(c.get('user')!.id, channelId))) {
    return c.text('You do not have permission to view this channel', 403);
  }

  const rawLimit = c.req.query('limit');
  if (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) {
    return c.text('Invalid limit', 400);
  }

  const limit = rawLimit ? Number(rawLimit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return c.text('Invalid limit', 400);
  }

  const beforeId = c.req.query('before');
  let before: { id: string; createdAt: Date } | null = null;

  if (beforeId) {
    before = await prisma.message.findFirst({
      where: { id: beforeId, channelId },
      select: { id: true, createdAt: true },
    });

    if (!before) {
      return c.text('Invalid before', 400);
    }
  }

  const rows = await prisma.message.findMany({
    where: {
      channelId,
      ...(before
        ? {
            OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      channelId: true,
      senderId: true,
      content: true,
      format: true,
      createdAt: true,
      sender: {
        select: { username: true, displayName: true },
      },
    },
  });

  const { page, nextCursor } = buildMessagePage(rows, limit);

  return c.json({ messages: page.reverse().map(toMessageDto), nextCursor }, 200);
});

export default app;
