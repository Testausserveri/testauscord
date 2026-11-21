import crypto from 'node:crypto';

export const TICKET_TTL_MS = 60_000;

export type TicketPayload = {
  userId: string;
  sessionId: string;
  expiresAt: number;
};

// shortcut: per-process ticket store, move behind shared storage before running multiple instances
const tickets = new Map<string, TicketPayload>();
let creations = 0;

const sweepExpired = (now: number) => {
  for (const [ticket, payload] of tickets) {
    if (payload.expiresAt <= now) tickets.delete(ticket);
  }
};

export const createTicket = (userId: string, sessionId: string, now = Date.now()): string => {
  if (++creations % 100 === 0) sweepExpired(now);

  const ticket = crypto.randomBytes(32).toString('base64url');

  tickets.set(ticket, {
    userId,
    sessionId,
    expiresAt: now + TICKET_TTL_MS,
  });

  return ticket;
};

export const redeemTicket = (ticket: string, now = Date.now()): TicketPayload | null => {
  const payload = tickets.get(ticket);
  if (!payload) return null;

  tickets.delete(ticket);

  return payload.expiresAt > now ? payload : null;
};
