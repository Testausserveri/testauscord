import { expect, test } from 'bun:test';
import { clientFrameSchema } from './protocol';

test('accepts valid client frames', () => {
  expect(
    clientFrameSchema.parse({
      type: 'SUBSCRIBE',
      nonce: 'sub-1',
      data: { channelId: '1800000000000000001' },
    }),
  ).toEqual({
    type: 'SUBSCRIBE',
    nonce: 'sub-1',
    data: { channelId: '1800000000000000001' },
  });

  expect(
    clientFrameSchema.parse({
      type: 'UNSUBSCRIBE',
      nonce: 'unsub-1',
      data: { channelId: '1800000000000000001' },
    }),
  ).toEqual({
    type: 'UNSUBSCRIBE',
    nonce: 'unsub-1',
    data: { channelId: '1800000000000000001' },
  });

  expect(
    clientFrameSchema.parse({
      type: 'PONG',
      data: { nonce: 'ping-1' },
    }),
  ).toEqual({
    type: 'PONG',
    data: { nonce: 'ping-1' },
  });
});

test('rejects malformed client frames', () => {
  expect(clientFrameSchema.safeParse({ type: 'SUBSCRIBE', nonce: 'x', data: {} }).success).toBe(false);
  expect(clientFrameSchema.safeParse({ type: 'UNSUBSCRIBE', nonce: 'x', data: { channelId: '' } }).success).toBe(false);
  expect(clientFrameSchema.safeParse({ type: 'PONG', data: {} }).success).toBe(false);
  expect(clientFrameSchema.safeParse({ type: 'MESSAGE_SEND', nonce: 'x', data: { channelId: '1' } }).success).toBe(false);
  expect(clientFrameSchema.safeParse({ type: 'SUBSCRIBE', nonce: 'x'.repeat(65), data: { channelId: '1' } }).success).toBe(false);
});
