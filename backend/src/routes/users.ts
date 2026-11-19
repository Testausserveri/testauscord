import { Hono } from 'hono';
import type { Variables } from '../types/types';
import { prisma } from '../db';

const app = new Hono<{ Variables: Variables }>();

app.get('/users/:id', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  let user;

  if (c.req.param('id') === '@me') {
    user = await prisma.user.findUnique({
      where: { id: c.get('user')!.id },
      select: {
        id: true,
        username: true,
      },
    });
  } else {
    user = await prisma.user.findUnique({
      where: { id: c.req.param('id') },
      select: {
        id: true,
        username: true,
      },
    });
  }

  if (!user) {
    return c.text('User not found', 404);
  } else {
    return c.json(user, 200);
  }
});

export default app;
