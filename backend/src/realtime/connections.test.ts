import type { ServerWebSocket } from 'bun';
import { expect, test } from 'bun:test';
import { HEARTBEAT_TIMEOUT_MS, MAX_SUBSCRIPTIONS } from './protocol';
import { addConnection, closeSessionConnections, markAlive, publishToChannel, removeConnection, runHeartbeatSweep, subscribe, unsubscribe, unsubscribeUserFromChannel } from './connections';

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

  addConnection(a.ws, 'user-a', 'session-a');
  addConnection(b.ws, 'user-b', 'session-b');
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

test('removes a user from a channel across all their connections', () => {
  const a1 = createSocket();
  const a2 = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a1.ws, 'user-a', 'session-a1');
  addConnection(a2.ws, 'user-a', 'session-a2');
  addConnection(b.ws, 'user-b', 'session-b');
  subscribe(a1.ws, channelId);
  subscribe(a2.ws, channelId);
  subscribe(b.ws, channelId);

  unsubscribeUserFromChannel('user-a', channelId);
  publishToChannel(channelId, 'event');

  expect(a1.sent).toEqual([]);
  expect(a2.sent).toEqual([]);
  expect(b.sent).toEqual(['event']);

  removeConnection(a1.ws);
  removeConnection(a2.ws);
  removeConnection(b.ws);
});

test('sends pings and closes stale connections', () => {
  const socket = createSocket();
  addConnection(socket.ws, 'user-heartbeat', 'session-heartbeat');
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

test('closes connections when their session is revoked', () => {
  const a = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a.ws, 'user-a', 'session-a');
  addConnection(b.ws, 'user-b', 'session-b');
  subscribe(a.ws, channelId);
  subscribe(b.ws, channelId);

  closeSessionConnections('session-a');
  publishToChannel(channelId, 'event');

  expect(a.closed).toEqual([4001]);
  expect(a.sent).toEqual([]);
  expect(b.sent).toEqual(['event']);

  removeConnection(b.ws);
});

test('rejects subscriptions past the cap', () => {
  const socket = createSocket();
  const prefix = crypto.randomUUID();

  addConnection(socket.ws, 'user-cap', 'session-cap');

  for (let index = 0; index < MAX_SUBSCRIPTIONS; index++) {
    expect(subscribe(socket.ws, `${prefix}-${index}`)).toBe(true);
  }

  expect(subscribe(socket.ws, `${prefix}-over-limit`)).toBe(false);

  removeConnection(socket.ws);
});
