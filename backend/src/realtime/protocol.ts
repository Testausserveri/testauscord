import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 75_000;
export const MAX_FRAME_BYTES = 16 * 1024;
export const MAX_BUFFERED_BYTES = 1024 * 1024;
export const MAX_SUBSCRIPTIONS = 200;
export const MAX_CONNECTIONS_PER_USER = 10;
export const MAX_FRAMES_PER_WINDOW = 60;
export const FRAME_WINDOW_MS = 10_000;

export const ERROR_CODES = ['INVALID_FRAME', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED', 'TOO_MANY_SUBSCRIPTIONS', 'UNSUPPORTED_VERSION', 'PAYLOAD_TOO_LARGE', 'INTERNAL'] as const;

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
  displayName: string | null;
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
  | { type: 'SERVER_MEMBER_REMOVED'; data: { serverId: string } }
  | { type: 'SERVER_UPDATED'; data: { server: { id: string; name: string } } }
  | { type: 'SESSION_REVOKED' }
  | { type: 'ERROR'; nonce?: string; data: { code: ErrorCode; message: string } };

export type ServerFrameType = ServerFrame['type'];

export const readyFrame = (user: UserRef): ServerFrame => ({
  type: 'READY',
  data: { user, protocolVersion: PROTOCOL_VERSION, heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS },
});

export const messageCreateFrame = (message: MessageDTO): ServerFrame => ({
  type: 'MESSAGE_CREATE',
  data: { message },
});

export const serverMemberRemovedFrame = (serverId: string): ServerFrame => ({
  type: 'SERVER_MEMBER_REMOVED',
  data: { serverId },
});

export const serverUpdatedFrame = (server: { id: string; name: string }): ServerFrame => ({
  type: 'SERVER_UPDATED',
  data: { server },
});

export const sessionRevokedFrame = (): ServerFrame => ({ type: 'SESSION_REVOKED' });

export const errorFrame = (code: ErrorCode, message: string, nonce?: string): ServerFrame => ({
  type: 'ERROR',
  ...(nonce === undefined ? {} : { nonce }),
  data: { code, message },
});
