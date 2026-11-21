import { expect, test } from 'bun:test';
import { createRateLimiter } from './rateLimit';

test('allows requests up to the limit and rejects the rest', () => {
  const limiter = createRateLimiter(2, 1_000);

  expect(limiter.check('key', 0)).toEqual({ allowed: true, retryAfterMs: 0 });
  expect(limiter.check('key', 1)).toEqual({ allowed: true, retryAfterMs: 0 });

  const blocked = limiter.check('key', 2);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBe(998);
});

test('resets after the window', () => {
  const limiter = createRateLimiter(1, 1_000);

  expect(limiter.check('key', 0).allowed).toBe(true);
  expect(limiter.check('key', 999).allowed).toBe(false);
  expect(limiter.check('key', 1_000).allowed).toBe(true);
});

test('tracks keys independently', () => {
  const limiter = createRateLimiter(1, 1_000);

  expect(limiter.check('a', 0).allowed).toBe(true);
  expect(limiter.check('b', 0).allowed).toBe(true);
  expect(limiter.check('a', 0).allowed).toBe(false);
});

test('frees capacity as individual requests age out', () => {
  const limiter = createRateLimiter(2, 1_000);

  expect(limiter.check('key', 0).allowed).toBe(true);
  expect(limiter.check('key', 100).allowed).toBe(true);
  expect(limiter.check('key', 200).allowed).toBe(false);

  expect(limiter.check('key', 1_000).allowed).toBe(true);
  expect(limiter.check('key', 1_050).allowed).toBe(false);
  expect(limiter.check('key', 1_101).allowed).toBe(true);
});
