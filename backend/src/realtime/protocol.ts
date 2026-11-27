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
  avatarVersion: number | null;
};

export type EffectivePresence = 'ONLINE' | 'IDLE' | 'DND' | 'OFFLINE';
export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE';

export type FriendRequestDTO = {
  id: string;
  createdAt: string;
  sender: UserRef;
};

export type FriendRequestRemoveReason = 'accepted' | 'rejected' | 'canceled';

export type ServerLayoutCategory = {
  id: string;
  name: string;
  position: number;
};

export type ServerLayoutChannel = {
  id: string;
  name: string | null;
  type: 'TEXT' | 'DM';
  categoryId: string | null;
  position: number;
};

export type ServerLayout = {
  categories: ServerLayoutCategory[];
  channels: ServerLayoutChannel[];
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
  | { type: 'SERVER_MEMBER_REMOVED'; data: { serverId: string; reason: 'kick' | 'ban' | 'leave' } }
  | { type: 'SERVER_MEMBER_ADDED'; data: { serverId: string } }
  | { type: 'SERVER_UPDATED'; data: { server: { id: string; name: string; iconVersion: number | null } } }
  | { type: 'SERVER_LAYOUT_UPDATE'; data: { serverId: string; layout: ServerLayout } }
  | { type: 'SERVER_ACCESS_UPDATE'; data: { serverId: string } }
  | { type: 'USER_UPDATED'; data: { user: UserRef } }
  | { type: 'FRIEND_REQUEST_CREATE'; data: { request: FriendRequestDTO } }
  | { type: 'FRIEND_REQUEST_REMOVE'; data: { requestId: string; reason: FriendRequestRemoveReason } }
  | { type: 'DM_CREATE'; data: { channelId: string } }
  | { type: 'PRESENCE_UPDATE'; data: { userId: string; status: EffectivePresence } }
  | { type: 'PRESENCE_SELF_UPDATE'; data: { presenceStatus: PresenceStatus } }
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

export const serverMemberRemovedFrame = (serverId: string, reason: 'kick' | 'ban' | 'leave'): ServerFrame => ({
  type: 'SERVER_MEMBER_REMOVED',
  data: { serverId, reason },
});

export const serverMemberAddedFrame = (serverId: string): ServerFrame => ({
  type: 'SERVER_MEMBER_ADDED',
  data: { serverId },
});

export const serverUpdatedFrame = (server: { id: string; name: string; iconVersion: number | null }): ServerFrame => ({
  type: 'SERVER_UPDATED',
  data: { server },
});

export const serverLayoutUpdateFrame = (serverId: string, layout: ServerLayout): ServerFrame => ({
  type: 'SERVER_LAYOUT_UPDATE',
  data: { serverId, layout },
});

export const serverAccessUpdateFrame = (serverId: string): ServerFrame => ({
  type: 'SERVER_ACCESS_UPDATE',
  data: { serverId },
});

export const userUpdatedFrame = (user: UserRef): ServerFrame => ({
  type: 'USER_UPDATED',
  data: { user },
});

export const friendRequestCreateFrame = (request: FriendRequestDTO): ServerFrame => ({
  type: 'FRIEND_REQUEST_CREATE',
  data: { request },
});

export const friendRequestRemoveFrame = (requestId: string, reason: FriendRequestRemoveReason): ServerFrame => ({
  type: 'FRIEND_REQUEST_REMOVE',
  data: { requestId, reason },
});

export const dmCreateFrame = (channelId: string): ServerFrame => ({
  type: 'DM_CREATE',
  data: { channelId },
});

export const presenceUpdateFrame = (userId: string, status: EffectivePresence): ServerFrame => ({
  type: 'PRESENCE_UPDATE',
  data: { userId, status },
});

export const presenceSelfUpdateFrame = (presenceStatus: PresenceStatus): ServerFrame => ({
  type: 'PRESENCE_SELF_UPDATE',
  data: { presenceStatus },
});

export const sessionRevokedFrame = (): ServerFrame => ({ type: 'SESSION_REVOKED' });

export const errorFrame = (code: ErrorCode, message: string, nonce?: string): ServerFrame => ({
  type: 'ERROR',
  ...(nonce === undefined ? {} : { nonce }),
  data: { code, message },
});
