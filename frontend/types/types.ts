export type CurrentUser = {
  id: string;
  username: string;
};

export type AccountSession = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type ServerAction = 'invite' | 'invites' | 'members' | 'leave' | 'settings';

export type Friend = {
  id: string;
  friendsSince: string;
  friend: {
    id: string;
    username: string;
  };
};

type MessageSender = {
  id: string;
  username: string;
};

export type Message = {
  id: string;
  createdAt: string;
  content: string;
  sender: MessageSender;
  channelId: string;
};

export type ServerChannel = {
  id: string;
  name: string;
  type: 'DM' | 'TEXT';
};

export type Server = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  channels: ServerChannel[];
};

export type ServerDetail = Server & {
  members: {
    id: string;
    username: string;
    joinedAt: string;
  }[];
};

export type ServerInvite = {
  code: string;
  createdAt: string;
  expiresAt: string;
  createdBy: {
    id: string;
    username: string;
  };
};
