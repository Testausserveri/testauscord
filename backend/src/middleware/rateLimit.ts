import { getConnInfo } from '@hono/bun';
import type { Context } from 'hono';
import type { RateLimiter } from '../utils/rateLimit';

const normalizeIp = (address: string): string => {
  const lower = address.toLowerCase();
  return lower.startsWith('::ffff:') && lower.includes('.') ? lower.slice(7) : lower;
};

export const parseTrustedProxies = (value: string | undefined): Set<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((entry) => normalizeIp(entry.trim()))
      .filter(Boolean),
  );

const trustedProxies = parseTrustedProxies(Bun.env.TRUSTED_PROXIES);

// shortcut: exact address matches, add CIDR parsing if proxies move within a range
export const resolveClientIp = (peer: string, forwardedFor: string | undefined, trusted: Set<string> = trustedProxies): string => {
  const normalizedPeer = normalizeIp(peer);
  if (!trusted.has(normalizedPeer)) return normalizedPeer;

  const chain = forwardedFor
    ?.split(',')
    .map((entry) => normalizeIp(entry.trim()))
    .filter(Boolean);
  if (!chain) return normalizedPeer;

  for (let index = chain.length - 1; index >= 0; index--) {
    const address = chain[index]!;
    if (!trusted.has(address)) return address;
  }

  return normalizedPeer;
};

export const clientIp = (c: Context): string => resolveClientIp(getConnInfo(c).remote.address ?? 'unknown', c.req.header('x-forwarded-for'));

export const enforceRateLimit = (c: Context, limiter: RateLimiter, key: string): Response | null => {
  const result = limiter.check(key);
  if (result.allowed) return null;

  c.header('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  return c.text('Too many requests', 429);
};
