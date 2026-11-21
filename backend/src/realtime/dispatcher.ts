import { eventBus, type DomainEvent } from './bus';
import { publishToChannel, publishToUser } from './connections';
import { messageCreateFrame, serverMemberRemovedFrame } from './protocol';

const dispatch = (event: DomainEvent): void => {
  if (event.type === 'MESSAGE_CREATE') {
    publishToChannel(event.channelId, JSON.stringify(messageCreateFrame(event.message)));
  } else if (event.type === 'SERVER_MEMBER_REMOVED') {
    publishToUser(event.userId, JSON.stringify(serverMemberRemovedFrame(event.serverId)));
  }
};

export const startDispatcher = (): (() => void) => eventBus.subscribe(dispatch);
