import { Hono } from 'hono';
import { prisma } from '../db';
import { generateId } from '../utils/utils';
import { createSession, generateSessionToken } from '../auth/session';
import { createSessionTokenCookie } from '../auth/cookie';
import { clientIp, enforceRateLimit } from '../middleware/rateLimit';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono();
const signupLimiter = createRateLimiter(10, 60 * 60_000);

app.post('/signup', async (c) => {
  const limited = enforceRateLimit(c, signupLimiter, clientIp(c));
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
  if (existingUser) {
    return c.text('Username already in use', 409);
  }

  const userId = generateId();
  const hashedPassword = await Bun.password.hash(password);

  await prisma.user.create({
    data: {
      id: userId,
      username: username,
      password: hashedPassword,
    },
  });

  const token = generateSessionToken();
  const session = await createSession(token, userId, c.req.header('user-agent')?.slice(0, 255));

  c.header('Set-Cookie', createSessionTokenCookie(token, session.expiresAt));

  return c.text('Success', 201);
});

export default app;
