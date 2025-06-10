import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import type { ContextData, Message, Variables } from '../types/types';
import type { ServerWebSocket } from 'bun';
import { z } from 'zod';
import { FriendRequestStatus, PrismaClient } from '@prisma/client';
import { generateId } from '../utils/utils';

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono<{ Variables: Variables }>();
const prisma = new PrismaClient();

const server = Bun.serve({
  fetch: app.fetch,
  websocket,
});

const socketContexts = new Map<ServerWebSocket, ContextData>();

const subscribe = z.object({
  channelId: z.string(),
  serverId: z.string().optional(),
});

const messageSend = z.object({
  channelId: z.string(),
  serverId: z.string().optional(),
  content: z.string(),
});

app.get(
  '/ws',
  async (c, next) => {
    if (!c.get('user') || !c.get('session')) {
      return c.text('This endpoint requires authentication', 401);
    }
    await next();
  },
  upgradeWebSocket(async (c) => {
    const userId = c.get('user')!.id;

    return {
      onOpen(_, ctx) {
        socketContexts.set(ctx.raw as ServerWebSocket, {
          userId,
          subscribedChannels: new Set(),
        });
      },

      async onMessage(event, ctx) {
        const ws = ctx.raw as ServerWebSocket;
        let data;
        try {
          data = JSON.parse(event.data as string);

          if (!data.type) return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        } catch (e) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }

        const context = socketContexts.get(ws);
        if (!context) return;

        switch (data.type) {
          case 'SUBSCRIBE': {
            const result = subscribe.safeParse(data.data);
            if (!result.success) return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            const channelId = data.data.channelId;
            const serverId = data.data.serverId;

            if (context.subscribedChannels.has(channelId)) {
              return ws.send(JSON.stringify({ type: 'error', message: 'Already subscribed' }));
            }

            if (serverId == null) {
              // DM
              const friendship = await prisma.friendRequest.findUnique({
                where: {
                  id: channelId,
                  status: FriendRequestStatus.ACCEPTED,
                  OR: [{ senderId: context.userId }, { receiverId: context.userId }],
                },
              });

              if (!friendship) {
                return ws.send(JSON.stringify({ type: 'error', message: 'Invalid channel' }));
              }
            } else return;

            context.subscribedChannels.add(channelId);
            ws.subscribe(channelId);
            break;
          }

          case 'UNSUBSCRIBE': {
            const result = subscribe.safeParse(data.data);
            if (!result.success) return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            const channelId = data.data.channelId;

            if (!context.subscribedChannels.has(channelId)) {
              return ws.send(JSON.stringify({ type: 'error', message: 'Not subscribed' }));
            }

            context.subscribedChannels.delete(channelId);
            ws.unsubscribe(channelId);
            break;
          }

          case 'MESSAGE_SEND': {
            const result = messageSend.safeParse(data.data);
            if (!result.success) return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            const { channelId, content, serverId } = data.data;
            const authorId = context.userId;

            if (serverId == null) {
              const friendship = await prisma.friendRequest.findUnique({
                where: {
                  id: channelId,
                  status: FriendRequestStatus.ACCEPTED,
                  OR: [{ senderId: authorId }, { receiverId: authorId }],
                },
              });

              if (!friendship) {
                return ws.send(JSON.stringify({ type: 'error', message: 'Invalid channel' }));
              }

              const message = await prisma.message.create({
                data: {
                  id: generateId(),
                  channelId,
                  senderId: authorId,
                  content,
                },
                include: {
                  sender: true,
                },
              });

              const payload = {
                type: 'MESSAGE_CREATE',
                data: {
                  id: message.id,
                  channelId: message.channelId,
                  serverId: serverId,
                  content: message.content,
                  sender: { id: message.senderId, username: message.sender.username },
                  createdAt: message.createdAt,
                },
              };

              server.publish(channelId, JSON.stringify(payload));
            } else return;
          }
        }
      },

      onClose: async (_, ctx) => {
        const ws = ctx.raw as ServerWebSocket;
      },
    };
  })
);

export default app;
