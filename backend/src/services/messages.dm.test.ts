import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

type Event = { type: string; [key: string]: unknown };

let channel: { members: { userId: string }[] } | null = null;
let messageCount = 0;
const events: Event[] = [];

const messageRow = (data: { id: string; channelId: string; senderId: string; content: string }) => ({
  ...data,
  format: 'TEXT' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  sender: { username: 'alice', displayName: 'Alice', avatarVersion: null },
});

const findMessage = mock(async () => null);
const createMessage = mock(async ({ data }: { data: { id: string; channelId: string; senderId: string; content: string } }) => {
  messageCount++;
  return messageRow(data);
});
const findChannel = mock(async () => (channel ? { ...channel, _count: { messages: messageCount } } : null));
const updateChannelMembers = mock(async () => ({ count: 2 }));

mock.module('../db', () => ({
  prisma: {
    message: { findUnique: findMessage, create: createMessage },
    channel: { findFirst: findChannel },
    channelMember: { updateMany: updateChannelMembers },
  },
}));

mock.module('../realtime/bus', () => ({
  eventBus: { publish: (event: Event) => events.push(event) },
}));

const { createChannelMessage } = await import('./messages');

beforeEach(() => {
  channel = null;
  messageCount = 0;
  events.length = 0;
  updateChannelMembers.mockClear();
});

afterAll(() => mock.restore());

const send = (clientNonce: string) => createChannelMessage({ channelId: 'channel-1', senderId: 'user-a', content: 'hello', clientNonce });

test('publishes DM_CREATE when the first message lands in a DM', async () => {
  channel = { members: [{ userId: 'user-a' }, { userId: 'user-b' }] };

  await send('nonce-1');

  expect(events.map((event) => event.type)).toEqual(['MESSAGE_CREATE', 'DM_CREATE']);
  expect(events[1]).toEqual({ type: 'DM_CREATE', channelId: 'channel-1', recipientIds: ['user-a', 'user-b'] });
  expect(updateChannelMembers).toHaveBeenCalledWith({ where: { channelId: 'channel-1' }, data: { dmVisible: true } });
});

test('does not publish DM_CREATE for later DM messages or server channels', async () => {
  channel = { members: [{ userId: 'user-a' }, { userId: 'user-b' }] };
  await send('nonce-1');
  events.length = 0;
  updateChannelMembers.mockClear();

  await send('nonce-2');
  expect(events.map((event) => event.type)).toEqual(['MESSAGE_CREATE']);
  expect(updateChannelMembers).not.toHaveBeenCalled();

  channel = null;
  events.length = 0;

  await send('nonce-3');
  expect(events.map((event) => event.type)).toEqual(['MESSAGE_CREATE']);
  expect(updateChannelMembers).not.toHaveBeenCalled();
});
