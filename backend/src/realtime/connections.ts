import type { ServerWebSocket } from 'bun';
import { createRateLimiter, type RateLimiter } from '../utils/rateLimit';
import { FRAME_WINDOW_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, MAX_CONNECTIONS_PER_USER, MAX_FRAMES_PER_WINDOW, MAX_SUBSCRIPTIONS, type ServerFrame } from './protocol';

type Connection = {
  ws: ServerWebSocket;
  userId: string;
  sessionId: string;
  sessionExpiresAt: number;
  nextSessionCheckAt: number;
  channels: Set<string>;
  lastSeenAt: number;
  pingSentAt: number | null;
  pingNonce: string | null;
  frameLimiter: RateLimiter;
};

export const SESSION_REVALIDATION_INTERVAL_MS = 5 * 60_000;

const connections = new Map<ServerWebSocket, Connection>();
const channelConnections = new Map<string, Set<Connection>>();

export const addConnection = (ws: ServerWebSocket, userId: string, sessionId: string, sessionExpiresAt: number, now = Date.now()): boolean => {
  if (connections.has(ws)) removeConnection(ws);

  let userConnections = 0;
  for (const connection of connections.values()) {
    if (connection.userId === userId) userConnections += 1;
  }

  if (userConnections >= MAX_CONNECTIONS_PER_USER) return false;

  connections.set(ws, {
    ws,
    userId,
    sessionId,
    sessionExpiresAt,
    nextSessionCheckAt: now,
    channels: new Set(),
    lastSeenAt: now,
    pingSentAt: null,
    pingNonce: null,
    frameLimiter: createRateLimiter(MAX_FRAMES_PER_WINDOW, FRAME_WINDOW_MS),
  });

  return true;
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

export const checkFrameBudget = (ws: ServerWebSocket, now = Date.now()): boolean => connections.get(ws)?.frameLimiter.check('frame', now).allowed ?? false;

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

    if (connection.sessionExpiresAt <= now) {
      connection.ws.close(4001, 'Session expired');
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

export type SessionLookup = (sessionId: string) => Promise<{ expiresAt: Date } | null>;

export const revalidateConnections = async (lookup: SessionLookup, now = Date.now()): Promise<void> => {
  for (const connection of [...connections.values()]) {
    if (connection.nextSessionCheckAt > now) continue;

    connection.nextSessionCheckAt = now + SESSION_REVALIDATION_INTERVAL_MS;

    let session: { expiresAt: Date } | null = null;
    try {
      session = await lookup(connection.sessionId);
    } catch {
      continue;
    }

    if (!session || session.expiresAt.getTime() <= now) {
      connection.ws.close(4001, 'Session expired');
      removeConnection(connection.ws);
      continue;
    }

    connection.sessionExpiresAt = session.expiresAt.getTime();
  }
};

export const startSessionRevalidation = (lookup: SessionLookup, intervalMs = SESSION_REVALIDATION_INTERVAL_MS): (() => void) => {
  const timer = setInterval(() => void revalidateConnections(lookup), intervalMs);
  return () => clearInterval(timer);
};

export const isSubscribed = (ws: ServerWebSocket, channelId: string): boolean => connections.get(ws)?.channels.has(channelId) ?? false;

export const subscribe = (ws: ServerWebSocket, channelId: string): boolean => {
  const connection = connections.get(ws);
  if (!connection) return false;
  if (connection.channels.has(channelId)) return true;
  if (connection.channels.size >= MAX_SUBSCRIPTIONS) return false;

  connection.channels.add(channelId);

  let subscribers = channelConnections.get(channelId);
  if (!subscribers) {
    subscribers = new Set();
    channelConnections.set(channelId, subscribers);
  }

  subscribers.add(connection);

  return true;
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

export const closeSessionConnections = (sessionId: string): void => {
  for (const connection of [...connections.values()]) {
    if (connection.sessionId !== sessionId) continue;

    connection.ws.close(4001, 'Session revoked');
    removeConnection(connection.ws);
  }
};

export const publishToChannel = (channelId: string, payload: string, now = Date.now()): void => {
  const subscribers = channelConnections.get(channelId);
  if (!subscribers) return;

  for (const connection of subscribers) {
    if (connection.sessionExpiresAt <= now) continue;
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(payload);
    }
  }
};

export const publishToUser = (userId: string, payload: string, now = Date.now()): void => {
  for (const connection of connections.values()) {
    if (connection.userId !== userId) continue;
    if (connection.sessionExpiresAt <= now) continue;
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(payload);
    }
  }
};
