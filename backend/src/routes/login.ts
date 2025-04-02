import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { createSession, generateSessionToken } from '../auth/session';
import { createSessionTokenCookie } from '../auth/cookie';

const prisma = new PrismaClient();
const app = new Hono();

app.post('/login', async (c) => {
  const { username, password } = await c.req.json();

  if (typeof username !== 'string' || username.length < 3 || username.length > 31 || !/^[a-z0-9_-]+$/.test(username)) {
    return c.text('Invalid username', 400);
  }

  if (typeof username !== 'string' || password.length < 8 || password.length > 255 || !/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/.test(password)) {
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

  const session = await createSession(generateSessionToken(), existingUser.id);

  c.header('Set-Cookie', createSessionTokenCookie(session.id, session.expiresAt));

  return c.json({ sessionId: session.id }, 200);
});

export default app;
