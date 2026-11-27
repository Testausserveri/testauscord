import { eventBus, type DomainEvent } from './bus';
import { publishToChannel, publishToUser } from './connections';
import {
  dmCreateFrame,
  friendRequestCreateFrame,
  friendRequestRemoveFrame,
  messageCreateFrame,
  serverAccessUpdateFrame,
  serverLayoutUpdateFrame,
  serverMemberAddedFrame,
  serverMemberRemovedFrame,
  serverUpdatedFrame,
  userUpdatedFrame,
} from './protocol';

const dispatch = (event: DomainEvent): void => {
  if (event.type === 'MESSAGE_CREATE') {
    publishToChannel(event.channelId, JSON.stringify(messageCreateFrame(event.message)));
  } else if (event.type === 'SERVER_MEMBER_REMOVED') {
    publishToUser(event.userId, JSON.stringify(serverMemberRemovedFrame(event.serverId, event.reason)));
  } else if (event.type === 'SERVER_MEMBER_ADDED') {
    const payload = JSON.stringify(serverMemberAddedFrame(event.serverId));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'SERVER_UPDATED') {
    const payload = JSON.stringify(serverUpdatedFrame(event.server));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'SERVER_LAYOUT_UPDATE') {
    const payload = JSON.stringify(serverLayoutUpdateFrame(event.serverId, event.layout));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'SERVER_ACCESS_UPDATE') {
    const payload = JSON.stringify(serverAccessUpdateFrame(event.serverId));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'USER_UPDATED') {
    const payload = JSON.stringify(userUpdatedFrame(event.user));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'FRIEND_REQUEST_CREATE') {
    const payload = JSON.stringify(friendRequestCreateFrame(event.request));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'FRIEND_REQUEST_REMOVE') {
    const payload = JSON.stringify(friendRequestRemoveFrame(event.requestId, event.reason));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  } else if (event.type === 'DM_CREATE') {
    const payload = JSON.stringify(dmCreateFrame(event.channelId));

    for (const userId of event.recipientIds) publishToUser(userId, payload);
  }
};

export const startDispatcher = (): (() => void) => eventBus.subscribe(dispatch);
