import type { ServerWebSocket } from 'bun';

type Connection = {
  ws: ServerWebSocket;
  userId: string;
  channels: Set<string>;
};

const connections = new Map<ServerWebSocket, Connection>();
const channelConnections = new Map<string, Set<Connection>>();

export const addConnection = (ws: ServerWebSocket, userId: string): void => {
  if (connections.has(ws)) removeConnection(ws);

  connections.set(ws, {
    ws,
    userId,
    channels: new Set(),
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

export const publishToChannel = (channelId: string, payload: string): void => {
  const subscribers = channelConnections.get(channelId);
  if (!subscribers) return;

  for (const connection of subscribers) {
    if (connection.ws.readyState === WebSocket.OPEN) {
      connection.ws.send(payload);
    }
  }
};
