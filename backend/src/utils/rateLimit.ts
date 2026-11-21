export type RateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
};

export type RateLimiter = {
  check(key: string, now?: number): RateLimitResult;
};

// shortcut: per-process sliding window log, move behind shared storage before running multiple instances
export const createRateLimiter = (limit: number, windowMs: number): RateLimiter => {
  const buckets = new Map<string, number[]>();
  let checks = 0;

  return {
    check(key, now = Date.now()) {
      if (++checks % 1000 === 0) {
        for (const [bucketKey, timestamps] of buckets) {
          const newest = timestamps[timestamps.length - 1];
          if (newest === undefined || newest <= now - windowMs) buckets.delete(bucketKey);
        }
      }

      const cutoff = now - windowMs;
      const timestamps = (buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

      if (timestamps.length >= limit) {
        buckets.set(key, timestamps);
        return { allowed: false, retryAfterMs: timestamps[0]! + windowMs - now };
      }

      timestamps.push(now);
      buckets.set(key, timestamps);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
};
