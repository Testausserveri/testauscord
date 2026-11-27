import type { EffectivePresence, MessageDTO, FriendRequestDTO, FriendRequestRemoveReason, ServerLayout, UserRef } from './protocol';

export type DomainEvent =
  | {
      type: 'MESSAGE_CREATE';
      channelId: string;
      message: MessageDTO;
    }
  | {
      type: 'SERVER_MEMBER_REMOVED';
      serverId: string;
      userId: string;
      reason: 'kick' | 'ban' | 'leave';
    }
  | {
      type: 'SERVER_MEMBER_ADDED';
      serverId: string;
      recipientIds: string[];
    }
  | {
      type: 'SERVER_UPDATED';
      server: { id: string; name: string; iconVersion: number | null };
      recipientIds: string[];
    }
  | {
      type: 'SERVER_LAYOUT_UPDATE';
      serverId: string;
      layout: ServerLayout;
      recipientIds: string[];
    }
  | {
      type: 'SERVER_ACCESS_UPDATE';
      serverId: string;
      recipientIds: string[];
    }
  | {
      type: 'USER_UPDATED';
      user: UserRef;
      recipientIds: string[];
    }
  | {
      type: 'FRIEND_REQUEST_CREATE';
      request: FriendRequestDTO;
      recipientIds: string[];
    }
  | {
      type: 'FRIEND_REQUEST_REMOVE';
      requestId: string;
      reason: FriendRequestRemoveReason;
      recipientIds: string[];
    }
  | {
      type: 'DM_CREATE';
      channelId: string;
      recipientIds: string[];
    }
  | {
      type: 'PRESENCE_UPDATE';
      userId: string;
      status: EffectivePresence;
      recipientIds: string[];
    };

export type EventListener = (event: DomainEvent) => void;

export type EventBus = {
  publish(event: DomainEvent): void;
  subscribe(listener: EventListener): () => void;
};

export const createLocalBus = (): EventBus => {
  const listeners = new Set<EventListener>();

  return {
    publish(event) {
      for (const listener of [...listeners]) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const eventBus = createLocalBus();
