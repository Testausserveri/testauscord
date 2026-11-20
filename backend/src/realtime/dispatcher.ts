import { eventBus, type DomainEvent } from './bus';
import { publishToChannel } from './connections';
import { messageCreateFrame } from './protocol';

const dispatch = (event: DomainEvent): void => {
  if (event.type === 'MESSAGE_CREATE') {
    publishToChannel(event.channelId, JSON.stringify(messageCreateFrame(event.message)));
  }
};

export const startDispatcher = (): (() => void) => eventBus.subscribe(dispatch);
