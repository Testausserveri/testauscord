import { expect, test } from 'bun:test';
import { buildMessagePage, toMessageDto } from './messages';

test('builds a page and an older-message cursor', () => {
  const rows = [{ id: '5' }, { id: '4' }, { id: '3' }];

  expect(buildMessagePage(rows, 2)).toEqual({
    page: [{ id: '5' }, { id: '4' }],
    nextCursor: '4',
  });

  expect(buildMessagePage(rows, 3)).toEqual({
    page: rows,
    nextCursor: null,
  });
});

test('maps a message record to the wire DTO', () => {
  expect(
    toMessageDto({
      id: '1',
      channelId: 'channel-1',
      senderId: 'user-1',
      content: 'hello',
      format: 'TEXT',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      sender: { username: 'alice', displayName: null },
    }),
  ).toEqual({
    id: '1',
    channelId: 'channel-1',
    content: 'hello',
    format: 'TEXT',
    sender: { id: 'user-1', username: 'alice', displayName: null },
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});
