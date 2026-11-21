import { upgradeWebSocket } from '@hono/bun';
import type { ServerWebSocket } from 'bun';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateSessionId } from '../auth/session';
import { addConnection, getUserId, isSubscribed, markAlive, removeConnection, subscribe, touchConnection, unsubscribe } from '../realtime/connections';
import { isAllowedOrigin } from '../realtime/origin';
import { PROTOCOL_VERSION, errorFrame, pongFrameSchema, type ErrorCode } from '../realtime/protocol';
import { redeemTicket } from '../realtime/ticket';
import { canAccessChannel } from '../services/access';
import type { Variables } from '../types/types';

const app = new Hono<{ Variables: Variables }>();

const subscribeSchema = z.object({
  channelId: z.string(),
});

const sendError = (ws: ServerWebSocket, code: ErrorCode, message: string) => {
  ws.send(JSON.stringify(errorFrame(code, message)));
};

app.get(
  '/ws',
  async (c, next) => {
    if (!isAllowedOrigin(c.req.header('origin'))) {
      return c.text('Forbidden', 403);
    }

    if (c.req.query('v') !== String(PROTOCOL_VERSION)) {
      return c.text('Unsupported protocol version', 400);
    }

    const ticket = c.req.query('ticket');
    const payload = ticket ? redeemTicket(ticket) : null;

    if (!payload) {
      return c.text('Unauthorized', 401);
    }

    const { session, user } = await validateSessionId(payload.sessionId);

    if (!session || !user || user.id !== payload.userId) {
      return c.text('Unauthorized', 401);
    }

    c.set('user', user);
    c.set('session', session);
    await next();
  },
  upgradeWebSocket(async (c) => {
    const userId = c.get('user')!.id;
    const sessionId = c.get('session')!.id;

    return {
      onOpen(_, ctx) {
        addConnection(ctx.raw as ServerWebSocket, userId, sessionId);
      },

      async onMessage(event, ctx) {
        const ws = ctx.raw as ServerWebSocket;
        const connectionUserId = getUserId(ws);
        if (!connectionUserId) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        touchConnection(ws);

        let data;
        try {
          data = JSON.parse(event.data as string);

          if (!data.type) {
            sendError(ws, 'INVALID_FRAME', 'Invalid payload');
            return;
          }
        } catch (error) {
          sendError(ws, 'INVALID_FRAME', 'Invalid JSON');
          return;
        }

        switch (data.type) {
          case 'PONG': {
            const result = pongFrameSchema.safeParse(data);
            if (result.success) markAlive(ws, result.data.data.nonce);
            return;
          }

          case 'SUBSCRIBE': {
            const result = subscribeSchema.safeParse(data.data);
            if (!result.success) {
              sendError(ws, 'INVALID_FRAME', 'Invalid payload');
              return;
            }

            const { channelId } = result.data;

            if (isSubscribed(ws, channelId)) return;

            if (!(await canAccessChannel(connectionUserId, channelId))) {
              sendError(ws, 'FORBIDDEN', 'Invalid channel');
              return;
            }

            if (!subscribe(ws, channelId)) {
              sendError(ws, 'TOO_MANY_SUBSCRIPTIONS', 'Too many subscriptions');
              return;
            }

            return;
          }

          case 'UNSUBSCRIBE': {
            const result = subscribeSchema.safeParse(data.data);
            if (!result.success) {
              sendError(ws, 'INVALID_FRAME', 'Invalid payload');
              return;
            }

            unsubscribe(ws, result.data.channelId);
            return;
          }
        }
      },

      onClose(_, ctx) {
        removeConnection(ctx.raw as ServerWebSocket);
      },
    };
  }),
);

export default app;
