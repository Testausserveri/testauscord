import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { validateSessionToken } from '../auth/session';
import { createSessionTokenCookie, deleteSessionTokenCookie } from '../auth/cookie';

const auth = async (c: Context, next: Next) => {
  let sessionToken = null;

  const authorization = c.req.header('Authorization');

  if (authorization) {
    sessionToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization;
  } else {
    sessionToken = getCookie(c, 'session') ?? null;
  }

  if (!sessionToken) {
    c.set('user', null);
    c.set('session', null);
    return next();
  }

  const { session, user } = await validateSessionToken(sessionToken);

  if (session) {
    c.header('Set-Cookie', createSessionTokenCookie(sessionToken, session.expiresAt), {
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
