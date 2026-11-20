import { Hono } from 'hono';
import { TICKET_TTL_MS, createTicket } from '../realtime/ticket';
import type { Variables } from '../types/types';

const app = new Hono<{ Variables: Variables }>();

app.post('/ticket', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const ticket = createTicket(c.get('user')!.id, c.get('session')!.id);

  return c.json({
    ticket,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString(),
  });
});

export default app;
