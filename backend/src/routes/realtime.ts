import { Hono } from 'hono';
import { enforceRateLimit } from '../middleware/rateLimit';
import { TICKET_TTL_MS, createTicket } from '../realtime/ticket';
import type { Variables } from '../types/types';
import { createRateLimiter } from '../utils/rateLimit';

const app = new Hono<{ Variables: Variables }>();
const ticketLimiter = createRateLimiter(30, 60_000);

app.post('/ticket', async (c) => {
  if (!c.get('user') || !c.get('session')) {
    return c.text('This endpoint requires authentication', 401);
  }

  const limited = enforceRateLimit(c, ticketLimiter, c.get('user')!.id);
  if (limited) return limited;

  const ticket = createTicket(c.get('user')!.id, c.get('session')!.id);

  return c.json({
    ticket,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString(),
  });
});

export default app;
