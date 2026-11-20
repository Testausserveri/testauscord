import crypto from 'node:crypto';
import { z } from 'zod';

// shortcut: 60s signed tickets, not single-use. Add jti replay cache if ticket leakage matters
export const TICKET_TTL_MS = 60_000;

const ticketPayloadSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export type TicketPayload = z.infer<typeof ticketPayloadSchema>;

const secret = Bun.env.WS_TICKET_SECRET ?? (Bun.env.NODE_ENV === 'production' ? null : crypto.randomBytes(32).toString('hex'));

if (!secret) {
  throw new Error('WS_TICKET_SECRET is required in production');
}

const sign = (body: string): string => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export const createTicket = (userId: string, sessionId: string, now = Date.now()): string => {
  const payload: TicketPayload = {
    userId,
    sessionId,
    exp: now + TICKET_TTL_MS,
    jti: crypto.randomUUID(),
  };

  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
};

export const verifyTicket = (ticket: string, now = Date.now()): TicketPayload | null => {
  const parts = ticket.split('.');
  if (parts.length !== 2) return null;

  const body = parts[0];
  const signature = parts[1];
  if (!body || !signature) return null;

  const expected = sign(body);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = ticketPayloadSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
};
