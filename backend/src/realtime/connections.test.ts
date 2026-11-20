import type { ServerWebSocket } from 'bun';
import { expect, test } from 'bun:test';
import { addConnection, publishToChannel, removeConnection, subscribe, unsubscribe } from './connections';

const createSocket = () => {
  const sent: string[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => sent.push(payload),
  } as unknown as ServerWebSocket;

  return { ws, sent };
};

test('publishes only to subscribed sockets and cleans up', () => {
  const a = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a.ws, 'user-a');
  addConnection(b.ws, 'user-b');
  subscribe(a.ws, channelId);
  subscribe(a.ws, channelId);
  subscribe(b.ws, channelId);

  publishToChannel(channelId, 'one');
  expect(a.sent).toEqual(['one']);
  expect(b.sent).toEqual(['one']);

  unsubscribe(a.ws, channelId);
  publishToChannel(channelId, 'two');
  expect(a.sent).toEqual(['one']);
  expect(b.sent).toEqual(['one', 'two']);

  removeConnection(b.ws);
  publishToChannel(channelId, 'three');
  expect(b.sent).toEqual(['one', 'two']);

  removeConnection(a.ws);
  removeConnection(a.ws);
});
