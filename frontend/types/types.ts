export type UserRef = {
  id: string;
  username: string;
  displayName: string | null;
  avatarVersion: number | null;
};

export type ProfileDTO = UserRef & {
  bio: string | null;
  canDm?: boolean;
};

export type AccountDTO = UserRef & {
  bio: string | null;
  allowDmsFromServerMembers: boolean;
};

export type ProfilePatch = {
  username?: string;
  displayName?: string | null;
  bio?: string | null;
  avatar?: string | null;
  avatarPoster?: string;
  allowDmsFromServerMembers?: boolean;
};

export type CurrentUser = AccountDTO;

export type AccountSession = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type ServerAction = 'invite' | 'invites' | 'members' | 'leave' | 'settings' | 'bans';

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
  iconVersion: number | null;
  channels: ServerChannel[];
  categories: ServerCategory[];
};

export type ServerPatch = {
  name?: string;
  icon?: string | null;
  iconPoster?: string;
};

export type ServerDetail = Server & {
  members: (UserRef & {
    joinedAt: string;
  })[];
};

export type ServerLayoutGroup = {
  categoryId: string | null;
  channelIds: string[];
};

export type ServerLayoutPayload = {
  categories: string[];
  groups: ServerLayoutGroup[];
};

export type ServerInvite = {
  code: string;
  createdAt: string;
  expiresAt: string;
  channel: { id: string; name: string } | null;
  createdBy: UserRef;
};

export type ServerBan = UserRef & {
  reason: string | null;
  createdAt: string;
  bannedBy: UserRef;
};
