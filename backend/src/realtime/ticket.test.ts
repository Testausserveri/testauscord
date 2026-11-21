import { expect, test } from 'bun:test';
import { TICKET_TTL_MS, createTicket, redeemTicket } from './ticket';

test('tickets are opaque and round trip once', () => {
  const now = 1_800_000_000_000;
  const ticket = createTicket('user-1', 'session-1', now);

  expect(ticket).not.toContain('user-1');
  expect(ticket).not.toContain('session-1');

  const payload = redeemTicket(ticket, now + 1000);

  expect(payload?.userId).toBe('user-1');
  expect(payload?.sessionId).toBe('session-1');
  expect(redeemTicket(ticket, now + 1000)).toBeNull();
});

test('unknown and expired tickets are rejected', () => {
  const now = 1_800_000_000_000;
  const ticket = createTicket('user-1', 'session-1', now);

  expect(redeemTicket('unknown', now)).toBeNull();
  expect(redeemTicket(ticket, now + TICKET_TTL_MS + 1)).toBeNull();
});
