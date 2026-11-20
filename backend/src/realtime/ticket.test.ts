import { expect, test } from 'bun:test';
import { TICKET_TTL_MS, createTicket, verifyTicket } from './ticket';

test('tickets round trip, expire, and reject tampering', () => {
  const now = 1_800_000_000_000;
  const ticket = createTicket('user-1', 'session-1', now);
  const payload = verifyTicket(ticket, now + 1000);

  expect(payload?.userId).toBe('user-1');
  expect(payload?.sessionId).toBe('session-1');
  expect(verifyTicket(ticket, now + TICKET_TTL_MS + 1)).toBeNull();
  expect(verifyTicket(`${ticket.slice(0, -1)}x`, now)).toBeNull();
  expect(verifyTicket(`${ticket}.extra`, now)).toBeNull();
});
