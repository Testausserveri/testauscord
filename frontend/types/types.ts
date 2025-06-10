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
