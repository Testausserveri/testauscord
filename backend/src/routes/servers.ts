import crypto from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { enforceRateLimit } from '../middleware/rateLimit';
import { eventBus } from '../realtime/bus';
import { unsubscribeUserFromChannel, closeUserConnectionsSilently } from '../realtime/connections';
import { isServerOwner } from '../services/access';
import { getBan } from '../services/moderation';
import { planCategoryDelete, planChannelAssign, planLayout, nextPosition, type ChannelPlacement } from '../services/serverLayout';
import { imageColumns, imageResponse, parseImageUpdate } from '../services/images';
import { nextServerPosition } from '../services/serverOrder';
import type { Variables } from '../types/types';
import { createRateLimiter } from '../utils/rateLimit';
import { generateId } from '../utils/utils';
import { containsBidiControls, containsControlChars } from '../utils/validation';

const app = new Hono<{ Variables: Variables }>();
const inviteLimiter = createRateLimiter(10, 60_000);
const serverCreateLimiter = createRateLimiter(10, 60 * 60_000);
const serverJoinLimiter = createRateLimiter(30, 60_000);
const serverRenameLimiter = createRateLimiter(10, 60 * 60_000);
const serverIconLimiter = createRateLimiter(300, 60_000);
const channelCreateLimiter = createRateLimiter(30, 60 * 60_000);
const channelAssignLimiter = createRateLimiter(60, 60_000);
const serverLayoutLimiter = createRateLimiter(60, 60_000);
const categoryMutationLimiter = createRateLimiter(30, 60 * 60_000);
const serverLeaveLimiter = createRateLimiter(10, 60_000);
const moderationLimiter = createRateLimiter(30, 60_000);
const serverOrderLimiter = createRateLimiter(60, 60_000);

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

const layoutSchema = z.object({
  categories: z.array(z.string().min(1).max(64)).max(MAX_CATEGORIES_PER_SERVER),
  groups: z
    .array(
      z.object({
        categoryId: z.string().min(1).max(64).nullable(),
        channelIds: z.array(z.string().min(1).max(64)).max(MAX_CHANNELS_PER_SERVER),
      }),
    )
    .max(MAX_CATEGORIES_PER_SERVER + 1),
});

const serverPatchSchema = z
  .object({
    name: serverNameSchema.optional(),
    icon: z.string().nullable().optional(),
    iconPoster: z.string().optional(),
  })
  .refine((value) => value.name !== undefined || value.icon !== undefined);

const categorySelect = { id: true, name: true, position: true } as const;

const findManageableServer = (serverId: string, userId: string) =>
  prisma.server.findFirst({
    where: { id: serverId, members: { some: { userId } } },
    select: { id: true, ownerId: true },
  });

const findServerChannels = (serverId: string) => prisma.channel.findMany({ where: { serverId }, select: { id: true } });

const evictServerMember = (serverId: string, userId: string, channels: { id: string }[], reason: 'kick' | 'ban') => {
  try {
    for (const channel of channels) unsubscribeUserFromChannel(userId, channel.id);
  } catch (error) {
    closeUserConnectionsSilently(userId);
    console.error(`Failed to unsubscribe ${userId} from server ${serverId}`, error);
  }

  eventBus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId, userId, reason });
};

const serverSelect = {
  id: true,
  name: true,
  iconVersion: true,
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

const publishServerLayout = async (serverId: string) => {
  const [categories, channels, members] = await Promise.all([
    prisma.channelCategory.findMany({
      where: { serverId },
      select: { id: true, name: true, position: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.channel.findMany({
      where: { serverId },
      select: { id: true, name: true, type: true, categoryId: true, position: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.serverMember.findMany({ where: { serverId }, select: { userId: true } }),
  ]);

  eventBus.publish({
    type: 'SERVER_LAYOUT_UPDATE',
    serverId,
    layout: { categories, channels },
    recipientIds: members.map((member) => member.userId),
  });

  return { categories, channels };
};

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

  const position = await nextServerPosition(userId);

  const server = await prisma.server.create({
    data: {
      id: generateId(),
      name: result.data.name,
      ownerId: userId,
      members: {
        create: { id: generateId(), userId, position },
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

  const userId = c.get('user')!.id;

  const memberships = await prisma.serverMember.findMany({
    where: { userId, server: { bans: { none: { userId } } } },
    orderBy: [{ position: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }],
    select: { server: { select: serverSelect } },
  });

  return c.json(
    memberships.map((membership) => membership.server),
    200,
  );
});

app.put('/order', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverOrderLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = z
    .array(z.string().min(1).max(64))
    .max(MAX_SERVER_MEMBERSHIPS)
    .refine((serverIds) => new Set(serverIds).size === serverIds.length)
    .safeParse((body as { serverIds?: unknown } | null)?.serverIds);

  if (!result.success) {
    return c.text('Invalid server order', 400);
  }

  const serverIds = result.data;

  const memberships = await prisma.serverMember.findMany({
    where: { userId, server: { bans: { none: { userId } } } },
    select: { id: true, serverId: true },
  });

  const membershipByServer = new Map(memberships.map((membership) => [membership.serverId, membership.id]));

  if (serverIds.length !== memberships.length || serverIds.some((serverId) => !membershipByServer.has(serverId))) {
    return c.text('Invalid server order', 400);
  }

  if (serverIds.length > 0) {
    await prisma.$transaction(serverIds.map((serverId, index) => prisma.serverMember.update({ where: { id: membershipByServer.get(serverId)! }, data: { position: index } })));
  }

  return c.body(null, 204);
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

  if (await getBan(invite.serverId, userId)) {
    return c.text('You are banned from this server', 403);
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

  const position = await nextServerPosition(userId);

  try {
    await prisma.serverMember.create({
      data: { id: generateId(), serverId: invite.serverId, userId, position },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return c.json(invite.server, 201);
  }

  const members = await prisma.serverMember.findMany({ where: { serverId: invite.serverId }, select: { userId: true } });
  eventBus.publish({ type: 'SERVER_MEMBER_ADDED', serverId: invite.serverId, recipientIds: members.map((member) => member.userId) });

  return c.json(invite.server, 201);
});

app.get('/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId: c.get('user')!.id } }, bans: { none: { userId: c.get('user')!.id } } },
    select: {
      ...serverSelect,
      members: {
        select: {
          joinedAt: true,
          user: { select: { id: true, username: true, displayName: true, avatarVersion: true } },
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
        avatarVersion: member.user.avatarVersion,
        joinedAt: member.joinedAt,
      })),
    },
    200,
  );
});

app.get('/:id/icon', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverIconLimiter, userId);
  if (limited) return limited;

  const wantsStatic = c.req.query('static') === '1';
  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId } }, bans: { none: { userId } } },
    select: { iconVersion: true, icon: { select: { data: true, contentType: true, posterData: true, posterContentType: true } } },
  });

  if (!server || !server.icon || server.iconVersion === null) {
    return c.text('Server icon not found', 404);
  }

  const { data, etag, headers } = imageResponse(server.icon, server.iconVersion, wantsStatic);

  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304, headers);
  }

  return c.body(data, 200, headers);
});

app.put('/:id/layout', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverLayoutLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = layoutSchema.safeParse(body);

  if (!result.success) {
    return c.text('Invalid layout', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can manage the layout', 403);
  }

  const [categories, channels] = await Promise.all([
    prisma.channelCategory.findMany({ where: { serverId: server.id }, select: { id: true, position: true } }),
    prisma.channel.findMany({ where: { serverId: server.id }, select: { id: true, categoryId: true, position: true } }),
  ]);

  const plan = planLayout(categories, channels, result.data);

  if (!plan) {
    return c.text('Invalid layout', 400);
  }

  if (plan.categories.length > 0 || plan.channels.length > 0) {
    await prisma.$transaction([
      ...plan.categories.map((entry) => prisma.channelCategory.update({ where: { id: entry.id }, data: { position: entry.position } })),
      ...plan.channels.map((entry) => prisma.channel.update({ where: { id: entry.id }, data: { categoryId: entry.categoryId, position: entry.position } })),
    ]);
  }

  const layout = await publishServerLayout(server.id);

  return c.json(layout, 200);
});

app.patch('/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const limited = enforceRateLimit(c, serverRenameLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = serverPatchSchema.safeParse(body);

  if (!result.success) {
    return c.text('Invalid server update', 400);
  }

  const { name, icon, iconPoster } = result.data;

  const server = await prisma.server.findFirst({
    where: { id: c.req.param('id'), members: { some: { userId } } },
    select: { id: true, name: true, ownerId: true, iconVersion: true },
  });

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can edit this server', 403);
  }

  const iconUpdate = await parseImageUpdate(icon, iconPoster);

  if (!iconUpdate.ok) {
    return c.text(iconUpdate.error === 'image' ? 'Invalid server icon' : 'Invalid server icon poster', 400);
  }

  const iconWrite = iconUpdate.update.image;
  const posterWrite = iconUpdate.update.poster;

  const renaming = name !== undefined && name !== server.name;
  const changingIcon = iconWrite !== undefined;

  if (!renaming && !changingIcon) {
    return c.json({ id: server.id, name: server.name, iconVersion: server.iconVersion }, 200);
  }

  const members = await prisma.serverMember.findMany({
    where: { serverId: server.id },
    select: { userId: true },
  });

  const nextName = renaming ? name : server.name;
  const nextIconVersion = iconWrite === undefined ? server.iconVersion : 'clear' in iconWrite ? null : iconWrite.version;

  if (iconWrite !== undefined) {
    await prisma.$transaction(async (tx) => {
      if ('clear' in iconWrite) {
        await tx.serverIcon.deleteMany({ where: { serverId: server.id } });
      } else {
        const columns = imageColumns(iconWrite, posterWrite);

        await tx.serverIcon.upsert({
          where: { serverId: server.id },
          create: { serverId: server.id, ...columns },
          update: columns,
        });
      }

      return tx.server.update({
        where: { id: server.id },
        data: { ...(renaming ? { name } : {}), iconVersion: nextIconVersion },
      });
    });
  } else {
    await prisma.server.update({
      where: { id: server.id },
      data: { name },
    });
  }

  eventBus.publish({
    type: 'SERVER_UPDATED',
    server: { id: server.id, name: nextName, iconVersion: nextIconVersion },
    recipientIds: members.map((member) => member.userId),
  });

  return c.json({ id: server.id, name: nextName, iconVersion: nextIconVersion }, 200);
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

    await publishServerLayout(server.id);

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

    await publishServerLayout(server.id);

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

  await publishServerLayout(server.id);

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

    await publishServerLayout(server.id);

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
  const result = z
    .object({
      name: channelNameSchema.optional(),
      categoryId: z.string().min(1).max(64).nullable().optional(),
    })
    .refine((data) => data.name !== undefined || data.categoryId !== undefined)
    .safeParse(body);

  if (!result.success) {
    return c.text('Invalid channel update', 400);
  }

  const server = await findManageableServer(c.req.param('id'), userId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, userId)) {
    return c.text('Only the server owner can manage channels', 403);
  }

  const channel = await prisma.channel.findFirst({
    where: { id: c.req.param('channelId'), serverId: server.id },
    select: { id: true, name: true, type: true, categoryId: true, position: true },
  });

  if (!channel) {
    return c.text('Channel not found', 404);
  }

  const { name, categoryId } = result.data;
  const renaming = name !== undefined && name !== channel.name;

  if (renaming) {
    const duplicate = await prisma.channel.findFirst({
      where: { serverId: server.id, id: { not: channel.id }, name },
      select: { id: true },
    });

    if (duplicate) {
      return c.text('Channel name already in use', 409);
    }
  }

  if (categoryId !== undefined && categoryId !== null) {
    const category = await prisma.channelCategory.findFirst({
      where: { id: categoryId, serverId: server.id },
      select: { id: true },
    });

    if (!category) {
      return c.text('Invalid category', 400);
    }
  }

  let plan: ChannelPlacement[] = [];

  if (categoryId !== undefined) {
    const channels = await prisma.channel.findMany({
      where: { serverId: server.id },
      select: { id: true, categoryId: true, position: true },
    });

    plan = planChannelAssign(channels, channel.id, categoryId);
  }

  const updates: Prisma.PrismaPromise<unknown>[] = [
    ...(renaming ? [prisma.channel.update({ where: { id: channel.id }, data: { name } })] : []),
    ...plan.map((entry) => prisma.channel.update({ where: { id: entry.id }, data: { categoryId: entry.categoryId, position: entry.position } })),
  ];

  try {
    if (updates.length > 0) {
      await prisma.$transaction(updates);
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Channel name already in use', 409);
    }
    throw error;
  }

  if (renaming || plan.length > 0) {
    await publishServerLayout(server.id);
  }

  const moved = plan.find((entry) => entry.id === channel.id);

  return c.json(
    {
      ...channel,
      name: renaming ? name : channel.name,
      categoryId: moved ? moved.categoryId : channel.categoryId,
      position: moved ? moved.position : channel.position,
    },
    200,
  );
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
      createdBy: { select: { id: true, username: true, displayName: true, avatarVersion: true } },
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

  const actorId = c.get('user')!.id;
  const limited = enforceRateLimit(c, moderationLimiter, actorId);
  if (limited) return limited;

  const server = await findManageableServer(c.req.param('id'), actorId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, actorId)) {
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

  const channels = await findServerChannels(server.id);

  await prisma.$transaction([prisma.serverMember.delete({ where: { id: membership.id } }), prisma.serverInvite.deleteMany({ where: { serverId: server.id, createdById: targetId } })]);

  evictServerMember(server.id, targetId, channels, 'kick');

  return c.body(null, 204);
});

app.put('/:id/bans/:userId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const actorId = c.get('user')!.id;
  const limited = enforceRateLimit(c, moderationLimiter, actorId);
  if (limited) return limited;

  const server = await findManageableServer(c.req.param('id'), actorId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, actorId)) {
    return c.text('Only the server owner can ban members', 403);
  }

  const targetId = c.req.param('userId');

  if (targetId === actorId) {
    return c.text('You cannot ban yourself', 400);
  }

  if (targetId === server.ownerId) {
    return c.text('The server owner cannot be banned', 400);
  }

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });

  if (!target) {
    return c.text('User not found', 404);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ reason: z.string().trim().max(200).optional() }).safeParse(body ?? {});

  if (!parsed.success) {
    return c.text('Invalid ban reason', 400);
  }

  const reason = parsed.data.reason || null;
  const channels = await findServerChannels(server.id);

  const [, removed] = await prisma.$transaction([
    prisma.serverBan.upsert({
      where: { serverId_userId: { serverId: server.id, userId: targetId } },
      create: { id: generateId(), serverId: server.id, userId: targetId, bannedById: actorId, reason },
      update: { bannedById: actorId, reason },
      select: { id: true },
    }),
    prisma.serverMember.deleteMany({ where: { serverId: server.id, userId: targetId } }),
    prisma.serverInvite.deleteMany({ where: { serverId: server.id, createdById: targetId } }),
  ]);

  if (removed.count > 0) {
    evictServerMember(server.id, targetId, channels, 'ban');
  }

  return c.body(null, 204);
});

app.delete('/:id/bans/:userId', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const actorId = c.get('user')!.id;
  const limited = enforceRateLimit(c, moderationLimiter, actorId);
  if (limited) return limited;

  const server = await findManageableServer(c.req.param('id'), actorId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, actorId)) {
    return c.text('Only the server owner can unban members', 403);
  }

  const ban = await getBan(server.id, c.req.param('userId'));

  if (!ban) {
    return c.text('Ban not found', 404);
  }

  await prisma.serverBan.delete({ where: { id: ban.id } });

  return c.body(null, 204);
});

app.get('/:id/bans', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const actorId = c.get('user')!.id;
  const limited = enforceRateLimit(c, moderationLimiter, actorId);
  if (limited) return limited;

  const server = await findManageableServer(c.req.param('id'), actorId);

  if (!server) {
    return c.text('Server not found', 404);
  }

  if (!isServerOwner(server, actorId)) {
    return c.text('Only the server owner can view bans', 403);
  }

  const bans = await prisma.serverBan.findMany({
    where: { serverId: server.id },
    select: {
      reason: true,
      createdAt: true,
      user: { select: { id: true, username: true, displayName: true, avatarVersion: true } },
      bannedBy: { select: { id: true, username: true, displayName: true, avatarVersion: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });

  return c.json(bans.map(({ user, ...ban }) => ({ ...user, ...ban })));
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

  eventBus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId: c.req.param('id'), userId, reason: 'leave' });

  return c.body(null, 204);
});

export default app;
