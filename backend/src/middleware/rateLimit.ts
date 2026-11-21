import { getConnInfo } from '@hono/bun';
import type { Context } from 'hono';
import type { RateLimiter } from '../utils/rateLimit';

export const clientIp = (c: Context): string => getConnInfo(c).remote.address ?? 'unknown';

export const enforceRateLimit = (c: Context, limiter: RateLimiter, key: string): Response | null => {
  const result = limiter.check(key);
  if (result.allowed) return null;

  c.header('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
  return c.text('Too many requests', 429);
};
