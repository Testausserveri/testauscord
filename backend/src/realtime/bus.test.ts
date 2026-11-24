import { expect, test } from 'bun:test';
import { createLocalBus } from './bus';

test('publishes to subscribers until they unsubscribe', () => {
  const bus = createLocalBus();
  const seen: string[] = [];
  const stop = bus.subscribe((event) => {
    if (event.type === 'MESSAGE_CREATE') seen.push(event.channelId);
  });

  bus.publish({
    type: 'MESSAGE_CREATE',
    channelId: 'channel-1',
    message: {
      id: '1',
      channelId: 'channel-1',
      content: 'hello',
      format: 'TEXT',
      sender: { id: 'user-1', username: 'alice', displayName: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  stop();

  bus.publish({
    type: 'MESSAGE_CREATE',
    channelId: 'channel-2',
    message: {
      id: '2',
      channelId: 'channel-2',
      content: 'ignored',
      format: 'TEXT',
      sender: { id: 'user-1', username: 'alice', displayName: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  expect(seen).toEqual(['channel-1']);
});

test('publishes membership events', () => {
  const bus = createLocalBus();
  const seen: string[] = [];
  const stop = bus.subscribe((event) => {
    if (event.type === 'SERVER_MEMBER_REMOVED') seen.push(event.serverId);
  });

  bus.publish({ type: 'SERVER_MEMBER_REMOVED', serverId: 'server-1', userId: 'user-1', reason: 'kick' });

  stop();

  expect(seen).toEqual(['server-1']);
});

test('publishes server updates with their recipients', () => {
  const bus = createLocalBus();
  const seen: string[][] = [];
  const stop = bus.subscribe((event) => {
    if (event.type === 'SERVER_UPDATED') seen.push(event.recipientIds);
  });

  bus.publish({ type: 'SERVER_UPDATED', server: { id: 'server-1', name: 'Renamed' }, recipientIds: ['user-1', 'user-2'] });

  stop();

  expect(seen).toEqual([['user-1', 'user-2']]);
});

test('publishes user updates with their recipients', () => {
  const bus = createLocalBus();
  const seen: string[][] = [];
  const stop = bus.subscribe((event) => {
    if (event.type === 'USER_UPDATED') seen.push(event.recipientIds);
  });

  bus.publish({ type: 'USER_UPDATED', user: { id: 'user-1', username: 'alice', displayName: 'Alice' }, recipientIds: ['user-1', 'user-2'] });

  stop();

  expect(seen).toEqual([['user-1', 'user-2']]);
});
