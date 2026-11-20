import type { ServerWebSocket } from 'bun';
import { expect, test } from 'bun:test';
import { HEARTBEAT_TIMEOUT_MS } from './protocol';
import { addConnection, markAlive, publishToChannel, removeConnection, runHeartbeatSweep, subscribe, unsubscribe } from './connections';

const createSocket = () => {
  const sent: string[] = [];
  const closed: number[] = [];
  const socket = {
    readyState: WebSocket.OPEN as number,
    send: (payload: string) => {
      sent.push(payload);
      return payload.length;
    },
    close: (code: number) => {
      closed.push(code);
      socket.readyState = WebSocket.CLOSED;
    },
  };

  return { ws: socket as unknown as ServerWebSocket, sent, closed };
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

test('sends pings and closes stale connections', () => {
  const socket = createSocket();
  addConnection(socket.ws, 'user-heartbeat');
  const now = Date.now();

  runHeartbeatSweep(now);
  expect(socket.sent).toHaveLength(1);

  const ping = JSON.parse(socket.sent[0]!);
  expect(ping.type).toBe('PING');
  expect(typeof ping.data.nonce).toBe('string');

  markAlive(socket.ws, ping.data.nonce, now + 1);
  runHeartbeatSweep(now + 50_000);
  expect(socket.closed).toEqual([]);
  expect(socket.sent).toHaveLength(2);

  runHeartbeatSweep(now + HEARTBEAT_TIMEOUT_MS + 2);

  expect(socket.closed).toEqual([4008]);
  expect(socket.sent).toHaveLength(2);

  removeConnection(socket.ws);
});
