import { Hono } from 'hono';
import { z } from 'zod';
import type { Variables } from '../types/types';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { eventBus } from '../realtime/bus';
import { imageColumns, imageResponse, parseImageUpdate } from '../services/images';
import { canViewUser, type ProfileDTO } from '../services/profiles';
import { createRateLimiter } from '../utils/rateLimit';
import { containsBidiControls, containsControlChars, isValidUsername } from '../utils/validation';

const app = new Hono<{ Variables: Variables }>();
const userLookupLimiter = createRateLimiter(60, 60_000);
const avatarLimiter = createRateLimiter(300, 60_000);
const profileWriteLimiter = createRateLimiter(30, 60 * 60_000);
const usernameChangeLimiter = createRateLimiter(10, 60 * 60_000);
const MAX_PROFILE_EVENT_RECIPIENTS = 500;

const profileSelect = { id: true, username: true, displayName: true, bio: true, avatarVersion: true } as const;

const profilePatchSchema = z
  .object({
    username: z.string().optional(),
    displayName: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
    avatarPoster: z.string().optional(),
  })
  .strict()
  .refine((value) => value.username !== undefined || value.displayName !== undefined || value.bio !== undefined || value.avatar !== undefined);

const isUniqueConstraintError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
};

const normalizeDisplayName = (value: string | null): string | null => {
  if (value === null) return null;

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const normalizeBio = (value: string | null): string | null => {
  if (value === null) return null;

  const normalized = value.replace(/\r\n/g, '\n').trimEnd();
  return normalized.length === 0 ? null : normalized;
};

app.patch('/users/@me', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, profileWriteLimiter, viewerId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const result = profilePatchSchema.safeParse(body);

  if (!result.success) {
    return c.text('Invalid profile', 400);
  }

  const { username, displayName, bio, avatar, avatarPoster } = result.data;

  if (username !== undefined) {
    const usernameLimited = enforceRateLimit(c, usernameChangeLimiter, viewerId);
    if (usernameLimited) return usernameLimited;

    if (!isValidUsername(username)) {
      return c.text('Invalid username', 400);
    }
  }

  const nextDisplayName = displayName === undefined ? undefined : normalizeDisplayName(displayName);

  if (nextDisplayName !== undefined && nextDisplayName !== null) {
    if (nextDisplayName.length > 32 || containsControlChars(nextDisplayName) || containsBidiControls(nextDisplayName)) {
      return c.text('Invalid display name', 400);
    }
  }

  const nextBio = bio === undefined ? undefined : normalizeBio(bio);

  if (nextBio !== undefined && nextBio !== null) {
    if (nextBio.length > 190 || containsControlChars(nextBio.replace(/\n/g, '')) || containsBidiControls(nextBio)) {
      return c.text('Invalid bio', 400);
    }
  }

  const avatarUpdate = await parseImageUpdate(avatar, avatarPoster);

  if (!avatarUpdate.ok) {
    return c.text(avatarUpdate.error === 'image' ? 'Invalid avatar' : 'Invalid avatar poster', 400);
  }

  const avatarWrite = avatarUpdate.update.image;
  const posterWrite = avatarUpdate.update.poster;

  const data: { username?: string; displayName?: string | null; bio?: string | null; avatarVersion?: number | null } = {};

  if (username !== undefined) data.username = username;
  if (nextDisplayName !== undefined) data.displayName = nextDisplayName;
  if (nextBio !== undefined) data.bio = nextBio;
  if (avatarWrite !== undefined) data.avatarVersion = 'clear' in avatarWrite ? null : avatarWrite.version;

  try {
    const user: ProfileDTO = await prisma.$transaction(async (tx) => {
      if (avatarWrite !== undefined) {
        if ('clear' in avatarWrite) {
          await tx.avatar.deleteMany({ where: { userId: viewerId } });
        } else {
          const columns = imageColumns(avatarWrite, posterWrite);

          await tx.avatar.upsert({
            where: { userId: viewerId },
            create: { userId: viewerId, ...columns },
            update: columns,
          });
        }
      }

      return tx.user.update({ where: { id: viewerId }, data, select: profileSelect });
    });

    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ userAId: viewerId }, { userBId: viewerId }] },
      select: { userAId: true, userBId: true },
    });

    const recipientIds = new Set<string>([viewerId]);

    for (const friendship of friendships) {
      recipientIds.add(friendship.userAId === viewerId ? friendship.userBId : friendship.userAId);
    }

    if (recipientIds.size <= MAX_PROFILE_EVENT_RECIPIENTS) {
      eventBus.publish({
        type: 'USER_UPDATED',
        user: { id: user.id, username: user.username, displayName: user.displayName, avatarVersion: user.avatarVersion },
        recipientIds: [...recipientIds],
      });
    }

    return c.json(user, 200);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.text('Username already in use', 409);
    }
    throw error;
  }
});

app.get('/users/:id/avatar', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, avatarLimiter, viewerId);
  if (limited) return limited;

  const targetId = c.req.param('id');
  const wantsStatic = c.req.query('static') === '1';
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { avatarVersion: true, avatar: { select: { data: true, contentType: true, posterData: true, posterContentType: true } } },
  });

  if (!user || !user.avatar || user.avatarVersion === null) {
    return c.text('Avatar not found', 404);
  }

  if (targetId !== viewerId && !(await canViewUser(viewerId, targetId))) {
    return c.text('Avatar not found', 404);
  }

  const { data, etag, headers } = imageResponse(user.avatar, user.avatarVersion, wantsStatic);

  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304, headers);
  }

  return c.body(data, 200, headers);
});

app.get('/users/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, userLookupLimiter, viewerId);
  if (limited) return limited;

  const targetId = c.req.param('id') === '@me' ? viewerId : c.req.param('id');

  const user: ProfileDTO | null = await prisma.user.findUnique({
    where: { id: targetId },
    select: profileSelect,
  });

  if (!user || (user.id !== viewerId && !(await canViewUser(viewerId, user.id)))) {
    return c.text('User not found', 404);
  }

  return c.json(user, 200);
});

export default app;
