import type { User, Session } from '@prisma/client';

export type Variables = {
  user: User | null;
  session: Session | null;
};

export type ContextData = {
  userId: string;
  subscribedChannels: Set<string>;
};

export type Message = {
  op: string;
  data: any;
};
