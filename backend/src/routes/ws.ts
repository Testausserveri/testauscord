import { upgradeWebSocket } from '@hono/bun';
import type { ServerWebSocket } from 'bun';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateSessionToken } from '../auth/session';
import { addConnection, getUserId, isSubscribed, markAlive, removeConnection, subscribe, touchConnection, unsubscribe } from '../realtime/connections';
import { isAllowedOrigin } from '../realtime/origin';
import { PROTOCOL_VERSION, pongFrameSchema } from '../realtime/protocol';
import { verifyTicket } from '../realtime/ticket';
import { canAccessChannel } from '../services/access';
import type { Variables } from '../types/types';

const app = new Hono<{ Variables: Variables }>();

const subscribeSchema = z.object({
  channelId: z.string(),
  serverId: z.string().optional(),
});

const sendError = (ws: ServerWebSocket, message: string) => {
  ws.send(JSON.stringify({ type: 'error', message }));
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
    const payload = ticket ? verifyTicket(ticket) : null;

    if (!payload) {
      return c.text('Unauthorized', 401);
    }

    const { session, user } = await validateSessionToken(payload.sessionId);

    if (!session || !user || user.id !== payload.userId) {
      return c.text('Unauthorized', 401);
    }

    c.set('user', user);
    c.set('session', session);
    await next();
  },
  upgradeWebSocket(async (c) => {
    const userId = c.get('user')!.id;

    return {
      onOpen(_, ctx) {
        addConnection(ctx.raw as ServerWebSocket, userId);
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
            sendError(ws, 'Invalid payload');
            return;
          }
        } catch (error) {
          sendError(ws, 'Invalid JSON');
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
              sendError(ws, 'Invalid payload');
              return;
            }

            const { channelId, serverId } = result.data;

            if (serverId != null) {
              sendError(ws, 'Server channels are not implemented yet');
              return;
            }

            if (isSubscribed(ws, channelId)) return;

            if (!(await canAccessChannel(connectionUserId, channelId))) {
              sendError(ws, 'Invalid channel');
              return;
            }

            subscribe(ws, channelId);
            return;
          }

          case 'UNSUBSCRIBE': {
            const result = subscribeSchema.safeParse(data.data);
            if (!result.success) {
              sendError(ws, 'Invalid payload');
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
