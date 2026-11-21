import type { ServerWebSocket } from 'bun';
import { expect, test } from 'bun:test';
import { eventBus } from './bus';
import { addConnection, removeConnection, subscribe } from './connections';
import { startDispatcher } from './dispatcher';
import type { MessageDTO } from './protocol';

test('dispatches message events to channel subscribers', () => {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => {
      sent.push(payload);
      return payload.length;
    },
  } as unknown as ServerWebSocket;

  const channelId = crypto.randomUUID();
  const message: MessageDTO = {
    id: 'message-1',
    channelId,
    content: 'hello',
    format: 'TEXT',
    sender: { id: 'user-1', username: 'alice' },
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  addConnection(ws, 'user-1', 'session-1', Date.now() + 60_000);
  subscribe(ws, channelId);

  const stop = startDispatcher();

  try {
    eventBus.publish({ type: 'MESSAGE_CREATE', channelId, message });

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      type: 'MESSAGE_CREATE',
      data: { message },
    });

    stop();
    eventBus.publish({ type: 'MESSAGE_CREATE', channelId, message });
    expect(sent).toHaveLength(1);
  } finally {
    stop();
    removeConnection(ws);
  }
});
