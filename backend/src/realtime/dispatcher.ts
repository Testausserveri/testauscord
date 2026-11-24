import { eventBus, type DomainEvent } from './bus';
import { publishToChannel, publishToUser } from './connections';
import { messageCreateFrame, serverMemberRemovedFrame, serverUpdatedFrame } from './protocol';

const dispatch = (event: DomainEvent): void => {
  if (event.type === 'MESSAGE_CREATE') {
    publishToChannel(event.channelId, JSON.stringify(messageCreateFrame(event.message)));
  } else if (event.type === 'SERVER_MEMBER_REMOVED') {
    publishToUser(event.userId, JSON.stringify(serverMemberRemovedFrame(event.serverId)));
  } else if (event.type === 'SERVER_UPDATED') {
    const payload = JSON.stringify(serverUpdatedFrame(event.server));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  }
};

export const startDispatcher = (): (() => void) => eventBus.subscribe(dispatch);
