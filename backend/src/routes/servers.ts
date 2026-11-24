import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { enforceRateLimit } from '../middleware/rateLimit';
import { eventBus } from '../realtime/bus';
import { unsubscribeUserFromChannel } from '../realtime/connections';
import { isServerOwner } from '../services/access';
import { planCategoryDelete, planChannelAssign, nextPosition } from '../services/serverLayout';
import type { Variables } from '../types/types';
import { createRateLimiter } from '../utils/rateLimit';
import { generateId } from '../utils/utils';
import { containsBidiControls, containsControlChars } from '../utils/validation';

const app = new Hono<{ Variables: Variables }>();
const inviteLimiter = createRateLimiter(10, 60_000);
const serverCreateLimiter = createRateLimiter(10, 60 * 60_000);
const serverJoinLimiter = createRateLimiter(30, 60_000);
const serverRenameLimiter = createRateLimiter(10, 60 * 60_000);
const channelCreateLimiter = createRateLimiter(30, 60 * 60_000);
const channelAssignLimiter = createRateLimiter(60, 60_000);
const categoryMutationLimiter = createRateLimiter(30, 60 * 60_000);
const serverLeaveLimiter = createRateLimiter(10, 60_000);

const MAX_SERVER_MEMBERSHIPS = 200;
const MAX_CHANNELS_PER_SERVER = 50;
const MAX_CATEGORIES_PER_SERVER = 20;
const MAX_INVITES_PER_SERVER = 50;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

const serverNameSchema = z.string().trim().min(1).max(100);
const categoryNameSchema = z.string().trim().min(1).max(50);
const channelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9-]+$/, 'Invalid channel name');

const categorySelect = { id: true, name: true, position: true } as const;

const findManageableServer = (serverId: string, userId: string) =>
  prisma.server.findFirst({
    where: { id: serverId, members: { some: { userId } } },
    select: { id: true, ownerId: true },
  });

const serverSelect = {
  id: true,
  name: true,
  ownerId: true,
  createdAt: true,
  channels: {
    select: { id: true, name: true, type: true, categoryId: true, position: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  categories: {
    select: { id: true, name: true, position: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ServerSelect;

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
          user: { select: { id: true, username: true, displayName: true } },
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
        displayName: member.user.displayName,
        joinedAt: member.joinedAt,
      })),
    },
    200,
  );
});

app.patch('/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverRenameLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: serverNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid server name', 400);
  }

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId } } },
    select: { id: true, name: true, ownerId: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can rename this server', 403);
  }

  const name = result.data.name;

  if (name === server.name) {
    return c.json({ id: server.id, name }, 200);
  }

  const members = await prisma.serverMember.findMany({
    where: { serverId: server.id },
    select: { userId: true },
  });

  await prisma.server.update({
    where: { id: server.id },
    data: { name },
  });

  eventBus.publish({
    type: 'SERVER_UPDATED',
    server: { id: server.id, name },
    recipientIds: members.map((member) => member.userId),
  });

  return c.json({ id: server.id, name }, 200);
});

app.post('/:id/categories', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, categoryMutationLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: categoryNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid category name', 400);
  }

  const name = result.data.name;

  if (containsControlChars(name) || containsBidiControls(name)) {
    return c.text('Invalid category name', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can manage categories', 403);
  }

  const duplicate = await prisma.channelCategory.findFirst({
    where: { serverId: server.id, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });

  if (duplicate) {
    return c.text('Category name already in use', 409);
  }

  const count = await prisma.channelCategory.count({ where: { serverId: server.id } });
  if (count >= MAX_CATEGORIES_PER_SERVER) {
    return c.text('Category limit reached', 409);
  }

  const siblings = await prisma.channelCategory.findMany({
    where: { serverId: server.id },
    select: { position: true },
  });

  try {
    const category = await prisma.channelCategory.create({
      data: {
        id: generateId(),
        serverId: server.id,
        name,
        position: nextPosition(siblings.map((sibling) => sibling.position)),
      },
      select: categorySelect,
    });

    return c.json(category, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Category name already in use', 409);
    }
    throw error;
  }
});

app.patch('/:id/categories/:categoryId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, categoryMutationLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: categoryNameSchema }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid category name', 400);
  }

  const name = result.data.name;

  if (containsControlChars(name) || containsBidiControls(name)) {
    return c.text('Invalid category name', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can manage categories', 403);
  }

  const category = await prisma.channelCategory.findFirst({
    where: { id: c.req.param('categoryId'), serverId: server.id },
    select: categorySelect,
  });

  if (!category) {
    return c.text('Category not found', 404);
  }

  if (category.name === name) {
    return c.json(category, 200);
  }

  const duplicate = await prisma.channelCategory.findFirst({
    where: { serverId: server.id, id: { not: category.id }, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });

  if (duplicate) {
    return c.text('Category name already in use', 409);
  }

  try {
    const updated = await prisma.channelCategory.update({
      where: { id: category.id },
      data: { name },
      select: categorySelect,
    });

    return c.json(updated, 200);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Category name already in use', 409);
    }
    throw error;
  }
});

app.delete('/:id/categories/:categoryId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, categoryMutationLimiter, userId);
  if (limited) return limited;

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can manage categories', 403);
  }

  const category = await prisma.channelCategory.findFirst({
    where: { id: c.req.param('categoryId'), serverId: server.id },
    select: { id: true },
  });

  if (!category) {
    return c.text('Category not found', 404);
  }

  const channels = await prisma.channel.findMany({
    where: { serverId: server.id },
    select: { id: true, categoryId: true, position: true },
  });

  const plan = planCategoryDelete(channels, category.id);

  await prisma.$transaction([
    prisma.channelCategory.delete({ where: { id: category.id } }),
    ...plan.map((entry) => prisma.channel.update({ where: { id: entry.id }, data: { categoryId: null, position: entry.position } })),
  ]);

  return c.body(null, 204);
});

app.post('/:id/channels', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, channelCreateLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ name: channelNameSchema, categoryId: z.string().min(1).max(64).optional() }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid channel name', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can create channels', 403);
  }

  let categoryId: string | null = null;

  if (result.data.categoryId !== undefined) {
    const category = await prisma.channelCategory.findFirst({
      where: { id: result.data.categoryId, serverId: server.id },
      select: { id: true },
    });

    if (!category) {
      return c.text('Invalid category', 400);
    }

    categoryId = category.id;
  }

  const channels = await prisma.channel.count({ where: { serverId: server.id } });
  if (channels >= MAX_CHANNELS_PER_SERVER) {
    return c.text('Channel limit reached', 409);
  }

  const siblings = await prisma.channel.findMany({
    where: { serverId: server.id, categoryId },
    select: { position: true },
  });

  try {
    const channel = await prisma.channel.create({
      data: {
        id: generateId(),
        serverId: server.id,
        name: result.data.name,
        type: 'TEXT',
        categoryId,
        position: nextPosition(siblings.map((sibling) => sibling.position)),
      },
      select: { id: true, name: true, type: true, categoryId: true, position: true },
    });

    return c.json(channel, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Channel name already in use', 409);
    }
    throw error;
  }
});

app.patch('/:id/channels/:channelId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, channelAssignLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z.object({ categoryId: z.string().min(1).max(64).nullable() }).safeParse(body);

  if (!result.success) {
    return c.text('Invalid category', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can move channels', 403);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: c.req.param('channelId'), serverId: server.id },
    select: { id: true, name: true, type: true, categoryId: true, position: true },
  });

  if (!channel) {
    return c.text('Channel not found', 404);
  }

  const categoryId = result.data.categoryId;

  if (categoryId !== null) {
    const category = await prisma.channelCategory.findFirst({
      where: { id: categoryId, serverId: server.id },
      select: { id: true },
    });

    if (!category) {
      return c.text('Invalid category', 400);
    }
  }

  const channels = await prisma.channel.findMany({
    where: { serverId: server.id },
    select: { id: true, categoryId: true, position: true },
  });

  const plan = planChannelAssign(channels, channel.id, categoryId);

  if (plan.length > 0) {
    await prisma.$transaction(plan.map((entry) => prisma.channel.update({ where: { id: entry.id }, data: { categoryId: entry.categoryId, position: entry.position } })));
  }

  const moved = plan.find((entry) => entry.id === channel.id);

  return c.json({ ...channel, categoryId: moved?.categoryId ?? categoryId, position: moved?.position ?? channel.position }, 200);
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
      createdBy: { select: { id: true, username: true, displayName: true } },
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
