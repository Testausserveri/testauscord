import type { MessageDTO, FriendRequestDTO, FriendRequestRemoveReason, UserRef } from './protocol';

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
    }
  | {
      type: 'SERVER_UPDATED';
      server: { id: string; name: string };
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
