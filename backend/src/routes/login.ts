import { Hono } from 'hono';
import { prisma } from '../db';
import { createSession, generateSessionToken } from '../auth/session';
import { createSessionTokenCookie } from '../auth/cookie';
import { clientIp, enforceRateLimit } from '../middleware/rateLimit';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono();
const loginLimiter = createRateLimiter(20, 5 * 60_000);

app.post('/login', async (c) => {
  const limited = enforceRateLimit(c, loginLimiter, clientIp(c));
  if (limited) return limited;

  const body = await c.req.json().catch(() => null);
  const username = body?.username;
  const password = body?.password;

  if (typeof username !== 'string' || username.length < 3 || username.length > 31 || !/^[a-z0-9_-]+$/.test(username)) {
    return c.text('Invalid username', 400);
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 255 || !/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/.test(password)) {
    return c.text('Invalid password', 400);
  }

  const existingUser = await prisma.user.findUnique({
    where: { username: username },
  });

  if (!existingUser) {
    return c.text('Incorrect username or password', 401);
  }

  const validPassword = await Bun.password.verify(password, existingUser.password);

  if (!validPassword) {
    return c.text('Incorrect username or password', 401);
  }

  const token = generateSessionToken();
  const session = await createSession(token, existingUser.id);

  c.header('Set-Cookie', createSessionTokenCookie(token, session.expiresAt));

  return c.text('Success', 200);
});

export default app;
