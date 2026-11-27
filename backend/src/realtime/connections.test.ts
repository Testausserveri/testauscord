import type { ServerWebSocket } from 'bun';
import { afterEach, expect, test } from 'bun:test';
import { FRAME_WINDOW_MS, HEARTBEAT_TIMEOUT_MS, MAX_CONNECTIONS_PER_USER, MAX_FRAMES_PER_WINDOW, MAX_SUBSCRIPTIONS } from './protocol';
import {
  addConnection,
  checkFrameBudget,
  closeSessionConnections,
  closeUserConnections,
  closeUserConnectionsSilently,
  isUserConnected,
  markAlive,
  openConnection,
  publishToChannel,
  publishToUser,
  removeConnection,
  revalidateConnections,
  runHeartbeatSweep,
  setOnLastConnectionRemoved,
  subscribe,
  unsubscribe,
  unsubscribeUserFromChannel,
} from './connections';

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

  return { ws: socket as unknown as ServerWebSocket, socket, sent, closed };
};

afterEach(() => setOnLastConnectionRemoved(null));

test('publishes only to subscribed sockets and cleans up', () => {
  const a = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a.ws, 'user-a', 'session-a', Date.now() + 60_000);
  addConnection(b.ws, 'user-b', 'session-b', Date.now() + 60_000);
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

test('reports a user connected while an open, unexpired socket exists', () => {
  const now = 1_800_000_000_000;
  const first = createSocket();
  const second = createSocket();
  const closed = createSocket();
  const expired = createSocket();

  expect(isUserConnected('user-presence', now)).toBe(false);

  addConnection(first.ws, 'user-presence', 'session-1', now + 60_000, now);
  expect(isUserConnected('user-presence', now)).toBe(true);

  addConnection(second.ws, 'user-presence', 'session-2', now + 60_000, now);
  expect(isUserConnected('user-presence', now)).toBe(true);

  removeConnection(first.ws);
  expect(isUserConnected('user-presence', now)).toBe(true);

  removeConnection(second.ws);
  expect(isUserConnected('user-presence', now)).toBe(false);

  addConnection(closed.ws, 'user-presence', 'session-closed', now + 60_000, now);
  closed.socket.readyState = WebSocket.CLOSED;
  expect(isUserConnected('user-presence', now)).toBe(false);
  removeConnection(closed.ws);

  addConnection(expired.ws, 'user-presence', 'session-expired', now - 1, now);
  expect(isUserConnected('user-presence', now)).toBe(false);
  removeConnection(expired.ws);
});

test('notifies only when the last connection for a user is removed', () => {
  const now = 1_800_000_000_000;
  const first = createSocket();
  const second = createSocket();
  const removed: string[] = [];

  addConnection(first.ws, 'user-last', 'session-last-1', now + 60_000, now);
  addConnection(second.ws, 'user-last', 'session-last-2', now + 60_000, now);
  setOnLastConnectionRemoved((userId) => removed.push(userId));

  removeConnection(first.ws);
  expect(removed).toEqual([]);

  removeConnection(second.ws);
  expect(removed).toEqual(['user-last']);
});

test('does not notify when a socket is replaced in place', () => {
  const now = 1_800_000_000_000;
  const socket = createSocket();
  const removed: string[] = [];

  addConnection(socket.ws, 'user-replace', 'session-replace-1', now + 60_000, now);
  setOnLastConnectionRemoved((userId) => removed.push(userId));

  addConnection(socket.ws, 'user-replace', 'session-replace-2', now + 60_000, now);
  expect(removed).toEqual([]);

  removeConnection(socket.ws);
  expect(removed).toEqual(['user-replace']);
});

test('notifies when a heartbeat sweep removes the last connection', () => {
  const now = 1_800_000_000_000;
  const closed = createSocket();
  const expired = createSocket();
  const removed: string[] = [];

  addConnection(closed.ws, 'user-sweep-closed', 'session-sweep-closed', now + 60_000, now);
  addConnection(expired.ws, 'user-sweep-expired', 'session-sweep-expired', now - 1, now);
  setOnLastConnectionRemoved((userId) => removed.push(userId));

  closed.socket.readyState = WebSocket.CLOSED;
  runHeartbeatSweep(now);

  expect(removed.sort()).toEqual(['user-sweep-closed', 'user-sweep-expired']);
});

test('notifies when forced closes and session revalidation remove the last connection', async () => {
  const now = 1_800_000_000_000;
  const forced = createSocket();
  const stale = createSocket();
  const removed: string[] = [];

  addConnection(forced.ws, 'user-forced', 'session-forced', now + 60_000, now);
  addConnection(stale.ws, 'user-stale', 'session-stale', now + 60_000, now);
  setOnLastConnectionRemoved((userId) => removed.push(userId));

  closeUserConnections('user-forced');
  await revalidateConnections(async () => null, now);

  expect(removed.sort()).toEqual(['user-forced', 'user-stale']);
});

test('publishes user events to every connection for that user', () => {
  const a1 = createSocket();
  const a2 = createSocket();
  const b = createSocket();
  const expired = createSocket();
  const now = 1_800_000_000_000;

  addConnection(a1.ws, 'user-a', 'session-a1', now + 60_000, now);
  addConnection(a2.ws, 'user-a', 'session-a2', now + 60_000, now);
  addConnection(b.ws, 'user-b', 'session-b', now + 60_000, now);
  addConnection(expired.ws, 'user-a', 'session-expired', now - 1, now);

  publishToUser('user-a', 'event', now);

  expect(a1.sent).toEqual(['event']);
  expect(a2.sent).toEqual(['event']);
  expect(b.sent).toEqual([]);
  expect(expired.sent).toEqual([]);

  removeConnection(a1.ws);
  removeConnection(a2.ws);
  removeConnection(b.ws);
  removeConnection(expired.ws);
});

test('removes a user from a channel across all their connections', () => {
  const a1 = createSocket();
  const a2 = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a1.ws, 'user-a', 'session-a1', Date.now() + 60_000);
  addConnection(a2.ws, 'user-a', 'session-a2', Date.now() + 60_000);
  addConnection(b.ws, 'user-b', 'session-b', Date.now() + 60_000);
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
  const now = Date.now();
  addConnection(socket.ws, 'user-heartbeat', 'session-heartbeat', now + 10 * 60_000, now);

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

  addConnection(a.ws, 'user-a', 'session-a', Date.now() + 60_000);
  addConnection(b.ws, 'user-b', 'session-b', Date.now() + 60_000);
  subscribe(a.ws, channelId);
  subscribe(b.ws, channelId);

  closeSessionConnections('session-a');
  publishToChannel(channelId, 'event');

  expect(a.sent).toHaveLength(1);
  expect(JSON.parse(a.sent[0]!).type).toBe('SESSION_REVOKED');
  expect(a.closed).toEqual([4001]);
  expect(b.sent).toEqual(['event']);

  removeConnection(b.ws);
});

test('closes every connection for a user', () => {
  const a1 = createSocket();
  const a2 = createSocket();
  const b = createSocket();

  addConnection(a1.ws, 'user-a', 'session-a1', Date.now() + 60_000);
  addConnection(a2.ws, 'user-a', 'session-a2', Date.now() + 60_000);
  addConnection(b.ws, 'user-b', 'session-b', Date.now() + 60_000);

  closeUserConnections('user-a');

  expect(a1.closed).toEqual([4001]);
  expect(a2.closed).toEqual([4001]);
  expect(JSON.parse(a1.sent[0]!).type).toBe('SESSION_REVOKED');
  expect(JSON.parse(a2.sent[0]!).type).toBe('SESSION_REVOKED');
  expect(b.closed).toEqual([]);
  expect(b.sent).toEqual([]);

  removeConnection(b.ws);
});

test('closes user connections for a reconnect without revoking the session', () => {
  const a1 = createSocket();
  const a2 = createSocket();
  const b = createSocket();
  const channelId = crypto.randomUUID();

  addConnection(a1.ws, 'user-silent', 'session-a1', Date.now() + 60_000);
  addConnection(a2.ws, 'user-silent', 'session-a2', Date.now() + 60_000);
  addConnection(b.ws, 'user-watcher', 'session-b', Date.now() + 60_000);
  subscribe(a1.ws, channelId);
  subscribe(a2.ws, channelId);
  subscribe(b.ws, channelId);

  closeUserConnectionsSilently('user-silent');
  publishToChannel(channelId, 'event');

  expect(a1.closed).toEqual([1012]);
  expect(a2.closed).toEqual([1012]);
  expect(a1.sent).toEqual([]);
  expect(a2.sent).toEqual([]);
  expect(b.sent).toEqual(['event']);

  removeConnection(b.ws);
});

test('stops delivering and closes once the session expires', () => {
  const socket = createSocket();
  const channelId = crypto.randomUUID();
  const now = 1_800_000_000_000;

  addConnection(socket.ws, 'user-expired', 'session-expired', now - 1, now);
  subscribe(socket.ws, channelId);

  publishToChannel(channelId, 'event', now);
  expect(socket.sent).toEqual([]);

  runHeartbeatSweep(now);
  expect(socket.closed).toEqual([4001]);

  removeConnection(socket.ws);
});

test('refreshes expiry from revalidation and throttles checks', async () => {
  const socket = createSocket();
  const now = 1_800_000_000_000;
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return { expiresAt: new Date(now + 10_000) };
  };

  addConnection(socket.ws, 'user-revalidate', 'session-revalidate', now + 1_000, now);

  await revalidateConnections(lookup, now);
  expect(calls).toBe(1);

  runHeartbeatSweep(now + 2_000);
  expect(socket.closed).toEqual([]);

  await revalidateConnections(lookup, now + 1_000);
  expect(calls).toBe(1);

  removeConnection(socket.ws);
});

test('closes connections when revalidation finds no session', async () => {
  const socket = createSocket();
  const now = 1_800_000_000_000;

  addConnection(socket.ws, 'user-gone', 'session-gone', now + 60_000, now);

  await revalidateConnections(async () => null, now);

  expect(socket.closed).toEqual([4001]);

  removeConnection(socket.ws);
});

test('rejects subscriptions past the cap', () => {
  const socket = createSocket();
  const prefix = crypto.randomUUID();

  addConnection(socket.ws, 'user-cap', 'session-cap', Date.now() + 60_000);

  for (let index = 0; index < MAX_SUBSCRIPTIONS; index++) {
    expect(subscribe(socket.ws, `${prefix}-${index}`)).toBe(true);
  }

  expect(subscribe(socket.ws, `${prefix}-over-limit`)).toBe(false);

  removeConnection(socket.ws);
});

test('caps connections per user', () => {
  const now = Date.now();
  const sockets = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => createSocket());

  for (const socket of sockets) {
    expect(addConnection(socket.ws, 'user-conn-cap', 'session-conn-cap', now + 60_000, now)).toBe(true);
  }

  const extra = createSocket();
  expect(addConnection(extra.ws, 'user-conn-cap', 'session-conn-cap-extra', now + 60_000, now)).toBe(false);

  const other = createSocket();
  expect(addConnection(other.ws, 'user-other', 'session-other', now + 60_000, now)).toBe(true);

  for (const socket of sockets) removeConnection(socket.ws);
  removeConnection(extra.ws);
  removeConnection(other.ws);
});

test('sends READY after the connection is accepted', () => {
  const socket = createSocket();

  expect(openConnection(socket.ws, { id: 'user-ready', username: 'alice', displayName: null, avatarVersion: null }, 'session-ready', Date.now() + 60_000)).toBe(true);

  expect(socket.closed).toEqual([]);
  expect(JSON.parse(socket.sent[0]!)).toMatchObject({
    type: 'READY',
    data: { user: { id: 'user-ready', username: 'alice' } },
  });

  removeConnection(socket.ws);
});

test('sends nothing when the connection cap rejects the socket', () => {
  const now = Date.now();
  const sockets = Array.from({ length: MAX_CONNECTIONS_PER_USER }, () => createSocket());

  for (const socket of sockets) {
    addConnection(socket.ws, 'user-ready-cap', 'session-ready-cap', now + 60_000, now);
  }

  const extra = createSocket();
  expect(openConnection(extra.ws, { id: 'user-ready-cap', username: 'alice', displayName: null, avatarVersion: null }, 'session-ready-cap-extra', now + 60_000, now)).toBe(false);

  expect(extra.sent).toEqual([]);
  expect(extra.closed).toEqual([4009]);

  for (const socket of sockets) removeConnection(socket.ws);
});

test('limits frames sent on one connection', () => {
  const socket = createSocket();
  const now = 1_800_000_000_000;

  addConnection(socket.ws, 'user-frame-budget', 'session-frame-budget', now + 60_000, now);

  for (let index = 0; index < MAX_FRAMES_PER_WINDOW; index++) {
    expect(checkFrameBudget(socket.ws, now)).toBe(true);
  }

  expect(checkFrameBudget(socket.ws, now)).toBe(false);
  expect(checkFrameBudget(socket.ws, now + FRAME_WINDOW_MS + 1)).toBe(true);

  removeConnection(socket.ws);
});
