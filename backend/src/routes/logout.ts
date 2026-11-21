import { Hono } from 'hono';
import { invalidateSession } from '../auth/session';
import { deleteSessionTokenCookie } from '../auth/cookie';
import { closeSessionConnections } from '../realtime/connections';
import type { Variables } from '../types/types';

const app = new Hono<{ Variables: Variables }>();

app.post('/logout', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('You are not logged in', 200);
  }

  const sessionId = c.get('session')!.id;

  await invalidateSession(sessionId);
  closeSessionConnections(sessionId);

  c.header('Set-Cookie', deleteSessionTokenCookie());

  return c.text('Success', 200);
});

export default app;
