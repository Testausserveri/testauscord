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
    sender: { id: 'user-1', username: 'alice', displayName: null },
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

test('dispatches member removal events to the removed user', () => {
  const sentA: string[] = [];
  const sentB: string[] = [];
  const socketA = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => {
      sentA.push(payload);
      return payload.length;
    },
  } as unknown as ServerWebSocket;
  const socketB = {
    readyState: WebSocket.OPEN,
    send: (payload: string) => {
      sentB.push(payload);
      return payload.length;
    },
  } as unknown as ServerWebSocket;

  addConnection(socketA, 'user-a', 'session-a', Date.now() + 60_000);
  addConnection(socketB, 'user-b', 'session-b', Date.now() + 60_000);

  const stop = startDispatcher();

  try {
    eventBus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId: 'server-1', userId: 'user-a' });

    expect(sentA).toEqual([JSON.stringify({ type: 'SERVER_MEMBER_REMOVED', data: { serverId: 'server-1' } })]);
    expect(sentB).toEqual([]);
  } finally {
    stop();
    removeConnection(socketA);
    removeConnection(socketB);
  }
});

test('dispatches server updates to every recipient and nobody else', () => {
  const sent: Record<string, string[]> = { 'user-a': [], 'user-b': [], 'user-out': [] };
  const sockets: ServerWebSocket[] = [];

  for (const userId of Object.keys(sent)) {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent[userId]!.push(payload);
        return payload.length;
      },
    } as unknown as ServerWebSocket;

    addConnection(socket, userId, `session-${userId}`, Date.now() + 60_000);
    sockets.push(socket);
  }

  const stop = startDispatcher();

  try {
    eventBus.publish({ type: 'SERVER_UPDATED', server: { id: 'server-1', name: 'Renamed' }, recipientIds: ['user-a', 'user-b'] });

    const frame = JSON.stringify({ type: 'SERVER_UPDATED', data: { server: { id: 'server-1', name: 'Renamed' } } });
    expect(sent['user-a']).toEqual([frame]);
    expect(sent['user-b']).toEqual([frame]);
    expect(sent['user-out']).toEqual([]);
  } finally {
    stop();
    for (const socket of sockets) removeConnection(socket);
  }
});

test('dispatches server layout updates to every recipient and nobody else', () => {
  const sent: Record<string, string[]> = { 'user-a': [], 'user-b': [], 'user-out': [] };
  const sockets: ServerWebSocket[] = [];

  for (const userId of Object.keys(sent)) {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent[userId]!.push(payload);
        return payload.length;
      },
    } as unknown as ServerWebSocket;

    addConnection(socket, userId, `session-${userId}`, Date.now() + 60_000);
    sockets.push(socket);
  }

  const stop = startDispatcher();

  try {
    const layout = {
      categories: [{ id: 'category-1', name: 'Projects', position: 0 }],
      channels: [{ id: 'channel-1', name: 'general', type: 'TEXT' as const, categoryId: 'category-1', position: 0 }],
    };
    eventBus.publish({ type: 'SERVER_LAYOUT_UPDATE', serverId: 'server-1', layout, recipientIds: ['user-a', 'user-b'] });

    const frame = JSON.stringify({ type: 'SERVER_LAYOUT_UPDATE', data: { serverId: 'server-1', layout } });
    expect(sent['user-a']).toEqual([frame]);
    expect(sent['user-b']).toEqual([frame]);
    expect(sent['user-out']).toEqual([]);
  } finally {
    stop();
    for (const socket of sockets) removeConnection(socket);
  }
});

test('dispatches friend request creates to the receiver only', () => {
  const sent: Record<string, string[]> = { 'user-a': [], 'user-b': [], 'user-out': [] };
  const sockets: ServerWebSocket[] = [];

  for (const userId of Object.keys(sent)) {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent[userId]!.push(payload);
        return payload.length;
      },
    } as unknown as ServerWebSocket;

    addConnection(socket, userId, `session-${userId}`, Date.now() + 60_000);
    sockets.push(socket);
  }

  const stop = startDispatcher();

  try {
    const request = { id: 'request-1', createdAt: '2026-01-01T00:00:00.000Z', sender: { id: 'user-a', username: 'alice', displayName: null } };
    eventBus.publish({ type: 'FRIEND_REQUEST_CREATE', request, recipientIds: ['user-b'] });

    const frame = JSON.stringify({ type: 'FRIEND_REQUEST_CREATE', data: { request } });
    expect(sent['user-b']).toEqual([frame]);
    expect(sent['user-a']).toEqual([]);
    expect(sent['user-out']).toEqual([]);
  } finally {
    stop();
    for (const socket of sockets) removeConnection(socket);
  }
});

test('dispatches friend request removals to both sides and nobody else', () => {
  const sent: Record<string, string[]> = { 'user-a': [], 'user-b': [], 'user-out': [] };
  const sockets: ServerWebSocket[] = [];

  for (const userId of Object.keys(sent)) {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent[userId]!.push(payload);
        return payload.length;
      },
    } as unknown as ServerWebSocket;

    addConnection(socket, userId, `session-${userId}`, Date.now() + 60_000);
    sockets.push(socket);
  }

  const stop = startDispatcher();

  try {
    eventBus.publish({ type: 'FRIEND_REQUEST_REMOVE', requestId: 'request-1', reason: 'accepted', recipientIds: ['user-a', 'user-b'] });

    const frame = JSON.stringify({ type: 'FRIEND_REQUEST_REMOVE', data: { requestId: 'request-1', reason: 'accepted' } });
    expect(sent['user-a']).toEqual([frame]);
    expect(sent['user-b']).toEqual([frame]);
    expect(sent['user-out']).toEqual([]);
  } finally {
    stop();
    for (const socket of sockets) removeConnection(socket);
  }
});

test('dispatches user updates to every recipient and nobody else', () => {
  const sent: Record<string, string[]> = { 'user-a': [], 'user-b': [], 'user-out': [] };
  const sockets: ServerWebSocket[] = [];

  for (const userId of Object.keys(sent)) {
    const socket = {
      readyState: WebSocket.OPEN,
      send: (payload: string) => {
        sent[userId]!.push(payload);
        return payload.length;
      },
    } as unknown as ServerWebSocket;

    addConnection(socket, userId, `session-${userId}`, Date.now() + 60_000);
    sockets.push(socket);
  }

  const stop = startDispatcher();

  try {
    const user = { id: 'user-a', username: 'alice', displayName: 'Alice' };
    eventBus.publish({ type: 'USER_UPDATED', user, recipientIds: ['user-a', 'user-b'] });

    const frame = JSON.stringify({ type: 'USER_UPDATED', data: { user } });
    expect(sent['user-a']).toEqual([frame]);
    expect(sent['user-b']).toEqual([frame]);
    expect(sent['user-out']).toEqual([]);
  } finally {
    stop();
    for (const socket of sockets) removeConnection(socket);
  }
});
