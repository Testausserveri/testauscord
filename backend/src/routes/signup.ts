import { Hono } from 'hono';
import { PrismaClient } from '@prisma/client';
import { generateId } from '../utils/utils';
import { createSession, generateSessionToken } from '../auth/session';
import { createSessionTokenCookie } from '../auth/cookie';

const prisma = new PrismaClient();
const app = new Hono();

app.post('/signup', async (c) => {
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

  const session = await createSession(generateSessionToken(), userId);

  c.header('Set-Cookie', createSessionTokenCookie(session.id, session.expiresAt));

  return c.json({ sessionId: session.id }, 201);
});

export default app;
