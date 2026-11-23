import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { eventBus } from '../realtime/bus';
import { unsubscribeUserFromChannel } from '../realtime/connections';
import type { Variables } from '../types/types';
import { createRateLimiter } from '../utils/rateLimit';
import { generateId } from '../utils/utils';

const app = new Hono<{ Variables: Variables }>();
const inviteLimiter = createRateLimiter(10, 60_000);
const serverCreateLimiter = createRateLimiter(10, 60 * 60_000);
const serverJoinLimiter = createRateLimiter(30, 60_000);
const channelCreateLimiter = createRateLimiter(30, 60 * 60_000);
const serverLeaveLimiter = createRateLimiter(10, 60_000);

const MAX_SERVER_MEMBERSHIPS = 200;
const MAX_CHANNELS_PER_SERVER = 50;
const MAX_INVITES_PER_SERVER = 50;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

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

const INVITE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const createInviteCode = (): string => {
  return Array.from({ length: 8 }, () => INVITE_ALPHABET.charAt(crypto.randomInt(INVITE_ALPHABET.length))).join('');
};

app.post('/create', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverCreateLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: serverNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid server name', 400);
  }

  const memberships = await prisma.serverMember.count({ where: { userId } });
  if (memberships >= MAX_SERVER_MEMBERSHIPS) {
    return c.text('Server limit reached', 409);
  }

  const server = await prisma.server.create({
    data: {
      id: generateId(),
      name: result.data.name,
      ownerId: userId,
      members: {
        create: { id: generateId(), userId },
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

app.post('/join', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverJoinLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ code: z.string().trim().min(1).max(64) }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid invite code', 400);
  }

  const invite = await prisma.serverInvite.findUnique({
    where: { code: result.data.code },
    select: {
      id: true,
      serverId: true,
      expiresAt: true,
      server: { select: serverSelect },
    },
  });

  if (!invite || invite.expiresAt.getTime() <= Date.now()) {
    if (invite) await prisma.serverInvite.deleteMany({ where: { id: invite.id } });
    return c.text('Invalid invite code', 404);
  }

  const existing = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: invite.serverId, userId } },
    select: { id: true },
  });

  if (existing) {
    return c.json(invite.server, 200);
  }

  const memberships = await prisma.serverMember.count({ where: { userId } });
  if (memberships >= MAX_SERVER_MEMBERSHIPS) {
    return c.text('Server limit reached', 409);
  }

  try {
    await prisma.serverMember.create({
      data: { id: generateId(), serverId: invite.serverId, userId },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  return c.json(invite.server, 201);
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

  const limited = enforceRateLimit(c, channelCreateLimiter, c.get('user')!.id);
  if (limited) return limited;

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

  const channels = await prisma.channel.count({ where: { serverId: c.req.param('id') } });
  if (channels >= MAX_CHANNELS_PER_SERVER) {
    return c.text('Channel limit reached', 409);
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

app.get('/:id/invites', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId: c.get('user')!.id } } },
    select: { id: true, ownerId: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (server.ownerId !== c.get('user')!.id) {
    return c.text('Only the server owner can manage invites', 403);
  }

  const invites = await prisma.serverInvite.findMany({
    where: { serverId: server.id, expiresAt: { gt: new Date() } },
    select: {
      code: true,
      createdAt: true,
      expiresAt: true,
      createdBy: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return c.json(invites, 200);
});

app.post('/:id/invites', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, inviteLimiter, c.get('user')!.id);
  if (limited) return limited;

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId: c.get('user')!.id } } },
    select: { id: true, ownerId: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  await prisma.serverInvite.deleteMany({ where: { serverId: server.id, expiresAt: { lte: new Date() } } });

  const invites = await prisma.serverInvite.count({ where: { serverId: server.id } });
  if (invites >= MAX_INVITES_PER_SERVER) {
    if (server.ownerId !== c.get('user')!.id) {
      return c.text('Invite limit reached', 409);
    }

    const existing = await prisma.serverInvite.findFirst({
      where: { serverId: server.id },
      select: { code: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (existing) {
      return c.json(existing, 200);
    }
  }

  const invite = await prisma.serverInvite.create({
    data: {
      id: generateId(),
      code: createInviteCode(),
      serverId: server.id,
      createdById: c.get('user')!.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { code: true },
  });

  return c.json(invite, 201);
});

app.delete('/:id/invites/:code', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId: c.get('user')!.id } } },
    select: { id: true, ownerId: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (server.ownerId !== c.get('user')!.id) {
    return c.text('Only the server owner can revoke invites', 403);
  }

  const invite = await prisma.serverInvite.findUnique({
    where: { code: c.req.param('code') },
    select: { id: true, serverId: true },
  });

  if (!invite || invite.serverId !== server.id) {
    return c.text('Invite not found', 404);
  }

  await prisma.serverInvite.delete({ where: { id: invite.id } });

  return c.body(null, 204);
});

app.delete('/:id/members/:userId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findUnique({
    where: { id: c.req.param('id') },
    select: { id: true, ownerId: true, channels: { select: { id: true } } },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (server.ownerId !== c.get('user')!.id) {
    return c.text('Only the server owner can remove members', 403);
  }

  const targetId = c.req.param('userId');

  if (targetId === server.ownerId) {
    return c.text('The server owner cannot be removed', 400);
  }

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: server.id, userId: targetId } },
    select: { id: true },
  });

  if (!membership) {
    return c.text('Member not found', 404);
  }

  await prisma.serverMember.delete({ where: { id: membership.id } });
  await prisma.serverInvite.deleteMany({ where: { serverId: server.id, createdById: targetId } });

  for (const channel of server.channels) {
    unsubscribeUserFromChannel(targetId, channel.id);
  }

  eventBus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId: server.id, userId: targetId });

  return c.body(null, 204);
});

app.post('/:id/leave', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverLeaveLimiter, userId);
  if (limited) return limited;

  const server = await prisma.server.findUnique({
    where: { id: c.req.param('id') },
    select: { ownerId: true, channels: { select: { id: true } } },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (server.ownerId === userId) {
    return c.text('The server owner cannot leave', 400);
  }

  const membership = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId: c.req.param('id'), userId } },
    select: { id: true },
  });

  if (!membership) {
    return c.text('You are not a member of this server', 403);
  }

  await prisma.serverMember.delete({ where: { id: membership.id } });
  for (const channel of server.channels) {
    unsubscribeUserFromChannel(userId, channel.id);
  }

  eventBus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId: c.req.param('id'), userId });

  return c.body(null, 204);
});

export default app;
