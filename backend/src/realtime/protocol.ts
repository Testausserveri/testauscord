import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 75_000;
export const MAX_FRAME_BYTES = 16 * 1024;
export const MAX_SUBSCRIPTIONS = 200;

export const ERROR_CODES = [
  'INVALID_FRAME',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TOO_MANY_SUBSCRIPTIONS',
  'UNSUPPORTED_VERSION',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const nonceSchema = z.string().min(1).max(64);
const channelIdSchema = z.string().min(1).max(64);

export const subscribeFrameSchema = z.object({
  type: z.literal('SUBSCRIBE'),
  nonce: nonceSchema,
  data: z.object({
    channelId: channelIdSchema,
  }),
});

export const unsubscribeFrameSchema = z.object({
  type: z.literal('UNSUBSCRIBE'),
  nonce: nonceSchema,
  data: z.object({
    channelId: channelIdSchema,
  }),
});

export const pongFrameSchema = z.object({
  type: z.literal('PONG'),
  data: z.object({
    nonce: nonceSchema,
  }),
});

export const clientFrameSchema = z.discriminatedUnion('type', [subscribeFrameSchema, unsubscribeFrameSchema, pongFrameSchema]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type UserRef = {
  id: string;
  username: string;
};

export type MessageFormat = 'TEXT' | 'E2EE';

export type MessageDTO = {
  id: string;
  channelId: string;
  content: string;
  format: MessageFormat;
  sender: UserRef;
  createdAt: string;
};

export type ReadyData = {
  user: UserRef;
  protocolVersion: typeof PROTOCOL_VERSION;
  heartbeatIntervalMs: number;
};

export type ServerFrame =
  | { type: 'READY'; data: ReadyData }
  | { type: 'PING'; data: { nonce: string } }
  | {
      type: 'ACK';
      nonce: string;
      data: { type: 'SUBSCRIBE' | 'UNSUBSCRIBE'; channelId: string };
    }
  | { type: 'MESSAGE_CREATE'; data: { message: MessageDTO } }
  | { type: 'ERROR'; nonce?: string; data: { code: ErrorCode; message: string } };

export type ServerFrameType = ServerFrame['type'];
