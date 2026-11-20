import type { ServerWebSocket } from 'bun';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, type ServerFrame } from './protocol';

type Connection = {
  ws: ServerWebSocket;
  userId: string;
  channels: Set<string>;
  lastSeenAt: number;
  pingSentAt: number | null;
  pingNonce: string | null;
};

const connections = new Map<ServerWebSocket, Connection>();
const channelConnections = new Map<string, Set<Connection>>();

export const addConnection = (ws: ServerWebSocket, userId: string): void => {
  if (connections.has(ws)) removeConnection(ws);

  connections.set(ws, {
    ws,
    userId,
    channels: new Set(),
    lastSeenAt: Date.now(),
    pingSentAt: null,
    pingNonce: null,
  });
};

export const removeConnection = (ws: ServerWebSocket): void => {
  const connection = connections.get(ws);
  if (!connection) return;

  for (const channelId of connection.channels) {
    const subscribers = channelConnections.get(channelId);
    if (!subscribers) continue;

    subscribers.delete(connection);
    if (subscribers.size === 0) channelConnections.delete(channelId);
  }

  connections.delete(ws);
};

export const getUserId = (ws: ServerWebSocket): string | undefined => connections.get(ws)?.userId;

export const touchConnection = (ws: ServerWebSocket, now = Date.now()): void => {
  const connection = connections.get(ws);
  if (connection) connection.lastSeenAt = now;
};

export const markAlive = (ws: ServerWebSocket, nonce?: string, now = Date.now()): void => {
  const connection = connections.get(ws);
  if (!connection) return;

  connection.lastSeenAt = now;

  if (nonce !== undefined && connection.pingNonce === nonce) {
    connection.pingSentAt = null;
    connection.pingNonce = null;
  }
};

export const runHeartbeatSweep = (now = Date.now()): void => {
  for (const connection of [...connections.values()]) {
    if (connection.ws.readyState !== WebSocket.OPEN) {
      removeConnection(connection.ws);
      continue;
    }

    if (now - connection.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
      connection.ws.close(4008, 'Heartbeat timeout');
      removeConnection(connection.ws);
      continue;
    }

    if (connection.pingSentAt !== null && now - connection.pingSentAt < HEARTBEAT_INTERVAL_MS) continue;

    const nonce = crypto.randomUUID();
    const frame: ServerFrame = { type: 'PING', data: { nonce } };

    connection.pingSentAt = now;
    connection.pingNonce = nonce;

    try {
      connection.ws.send(JSON.stringify(frame));
    } catch {
      removeConnection(connection.ws);
    }
  }
};

export const startHeartbeat = (): (() => void) => {
  const timer = setInterval(() => runHeartbeatSweep(), HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
};

export const isSubscribed = (ws: ServerWebSocket, channelId: string): boolean => connections.get(ws)?.channels.has(channelId) ?? false;

export const subscribe = (ws: ServerWebSocket, channelId: string): void => {
  const connection = connections.get(ws);
  if (!connection || connection.channels.has(channelId)) return;

  connection.channels.add(channelId);

  let subscribers = channelConnections.get(channelId);
  if (!subscribers) {
    subscribers = new Set();
    channelConnections.set(channelId, subscribers);
  }

  subscribers.add(connection);
};

export const unsubscribe = (ws: ServerWebSocket, channelId: string): void => {
  const connection = connections.get(ws);
  if (!connection) return;

  connection.channels.delete(channelId);

  const subscribers = channelConnections.get(channelId);
  if (!subscribers) return;

  subscribers.delete(connection);
  if (subscribers.size === 0) channelConnections.delete(channelId);
};

export const unsubscribeUserFromChannel = (userId: string, channelId: string): void => {
  const subscribers = channelConnections.get(channelId);
  if (!subscribers) return;

  for (const connection of [...subscribers]) {
    if (connection.userId === userId) unsubscribe(connection.ws, channelId);
  }
};

export const publishToChannel = (channelId: string, payload: string): void => {
  const subscribers = channelConnections.get(channelId);
  if (!subscribers) return;

  for (const connection of subscribers) {
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(payload);
    }
  }
};
