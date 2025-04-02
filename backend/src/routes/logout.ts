import { Hono } from 'hono';
import { invalidateSession } from '../auth/session';
import { deleteSessionTokenCookie } from '../auth/cookie';
import type { Variables } from '../types/types';

const app = new Hono<{ Variables: Variables }>();

app.post('/logout', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('You are not logged in', 200);
  }

  await invalidateSession(c.get('session')!.id);

  c.header('Set-Cookie', deleteSessionTokenCookie());

  return c.text('Success', 200);
});

export default app;
