import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { validateSessionToken } from '../auth/session';
import { createSessionTokenCookie, deleteSessionTokenCookie } from '../auth/cookie';

const auth = async (c: Context, next: Next) => {
  let sessionId = null;

  const authorization = c.req.header('Authorization');

  if (authorization) {
    sessionId = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization;
  } else {
    sessionId = getCookie(c, 'session') ?? null;
  }

  if (!sessionId) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  const { session, user } = await validateSessionToken(sessionId);

  if (session) {
    c.header('Set-Cookie', createSessionTokenCookie(session.id, session.expiresAt), {
      append: true,
    });
  }

  if (!session) {
    c.header('Set-Cookie', deleteSessionTokenCookie(), {
      append: true,
    });
  }

  c.set('user', user);
  c.set('session', session);
  return next();
};

export default auth;
