import { Hono } from 'hono';
import { prisma } from '../db';
import { deleteSessionTokenCookie } from '../auth/cookie';
import { enforceRateLimit } from '../middleware/rateLimit';
import { closeSessionConnections } from '../realtime/connections';
import type { Variables } from '../types/types';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono<{ Variables: Variables }>();
const passwordLimiter = createRateLimiter(5, 15 * 60_000);

const PASSWORD_PATTERN = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/;

app.get('/account/sessions', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const currentSessionId = c.get('session')!.id;

  const sessions = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
  });

  return c.json(
    sessions.map((session) => ({ ...session, current: session.id === currentSessionId })),
    200,
  );
});

app.delete('/account/sessions/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;
  const currentSessionId = c.get('session')!.id;
  const sessionId = c.req.param('id');

  const { count } = await prisma.session.deleteMany({
    where: { id: sessionId, userId },
  });

  if (count === 0) {
    return c.text('Session not found', 404);
  }

  closeSessionConnections(sessionId);

  if (sessionId === currentSessionId) {
    c.header('Set-Cookie', deleteSessionTokenCookie());
  }

  return c.body(null, 204);
});

app.delete('/account/sessions', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;

  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true },
  });

  await prisma.session.deleteMany({ where: { userId } });

  for (const session of sessions) {
    closeSessionConnections(session.id);
  }

  c.header('Set-Cookie', deleteSessionTokenCookie());

  return c.body(null, 204);
});

app.post('/account/password', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const userId = c.get('user')!.id;

  const limited = enforceRateLimit(c, passwordLimiter, userId);
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;

  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 255 || !PASSWORD_PATTERN.test(newPassword)) {
    return c.text('Invalid password', 400);
  }

  if (currentPassword === newPassword) {
    return c.text('New password must be different', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true },
  });

  if (!user) {
    return c.text('User not found', 404);
  }

  if (!(await Bun.password.verify(currentPassword, user.password))) {
    return c.text('Incorrect password', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { password: await Bun.password.hash(newPassword) },
  });

  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true },
  });

  await prisma.session.deleteMany({ where: { userId } });

  for (const session of sessions) {
    closeSessionConnections(session.id);
  }

  c.header('Set-Cookie', deleteSessionTokenCookie());

  return c.text('Password changed', 200);
});

export default app;
