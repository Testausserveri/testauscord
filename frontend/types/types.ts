export type UserRef = {
  id: string;
  username: string;
  displayName: string | null;
};

export type ProfileDTO = UserRef & {
  bio: string | null;
};

export type ProfilePatch = {
  username?: string;
  displayName?: string | null;
  bio?: string | null;
};

export type CurrentUser = ProfileDTO;

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
  friend: UserRef;
};

export type IncomingFriendRequest = {
  id: string;
  createdAt: string;
  sender: UserRef;
};

export type OutgoingFriendRequest = {
  id: string;
  createdAt: string;
  receiver: UserRef;
};

type MessageSender = UserRef;

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
  categoryId: string | null;
  position: number;
};

export type ServerCategory = {
  id: string;
  name: string;
  position: number;
};

export type Server = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  channels: ServerChannel[];
  categories: ServerCategory[];
};

export type ServerDetail = Server & {
  members: (UserRef & {
    joinedAt: string;
  })[];
};

export type ServerInvite = {
  code: string;
  createdAt: string;
  expiresAt: string;
  createdBy: UserRef;
};
