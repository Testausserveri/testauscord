import type { MessageDTO } from './protocol';

export type DomainEvent = {
  type: 'MESSAGE_CREATE';
  channelId: string;
  message: MessageDTO;
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
