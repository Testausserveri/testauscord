import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { prisma } from '../db';
import { enforceRateLimit } from '../middleware/rateLimit';
import { canViewUser } from '../services/profiles';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono<{ Variables: Variables }>();
const userLookupLimiter = createRateLimiter(60, 60_000);

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
