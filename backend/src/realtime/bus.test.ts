import { expect, test } from 'bun:test';
import { createLocalBus } from './bus';

test('publishes to subscribers until they unsubscribe', () => {
  const bus = createLocalBus();
  const seen: string[] = [];
  const stop = bus.subscribe((event) => seen.push(event.channelId));

  bus.publish({
    type: 'MESSAGE_CREATE',
    channelId: 'channel-1',
    message: {
      id: '1',
      channelId: 'channel-1',
      content: 'hello',
      format: 'TEXT',
      sender: { id: 'user-1', username: 'alice' },
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
      sender: { id: 'user-1', username: 'alice' },
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  });

  expect(seen).toEqual(['channel-1']);
});
