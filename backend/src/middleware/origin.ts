import type { MiddlewareHandler } from 'hono';
import { isAllowedOrigin } from '../realtime/origin';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const enforceTrustedOrigin =
  (allowedOrigin = Bun.env.FRONTEND_URL): MiddlewareHandler =>
  async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !isAllowedOrigin(c.req.header('origin'), allowedOrigin)) {
      return c.text('Forbidden', 403);
    }

    await next();
  };
