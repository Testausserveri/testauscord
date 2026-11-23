import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { friendPair } from '../services/directMessages';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono<{ Variables: Variables }>();
const userLookupLimiter = createRateLimiter(60, 60_000);

const canViewUser = async (viewerId: string, targetId: string): Promise<boolean> => {
  const [friendship, sharedServer] = await Promise.all([
    prisma.friendship.findUnique({
      where: { userAId_userBId: friendPair(viewerId, targetId) },
      select: { id: true },
    }),
    prisma.serverMember.findFirst({
      where: { userId: viewerId, server: { members: { some: { userId: targetId } } } },
      select: { id: true },
    }),
  ]);

  return Boolean(friendship || sharedServer);
};

app.get('/users/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const viewerId = c.get('user')!.id;
  const limited = enforceRateLimit(c, userLookupLimiter, viewerId);
  if (limited) return limited;

  const targetId = c.req.param('id') === '@me' ? viewerId : c.req.param('id');

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, username: true },
  });

  if (!user || (user.id !== viewerId && !(await canViewUser(viewerId, user.id)))) {
    return c.text('User not found', 404);
  }

  return c.json(user, 200);
});

export default app;
