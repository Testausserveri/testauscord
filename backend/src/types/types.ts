import type { User, Session } from '../generated/prisma/client';
import type { UserRef } from '../realtime/protocol';

export type AuthUser = Pick<User, 'id' | 'username'>;
export type AuthSession = Pick<Session, 'id' | 'userId' | 'expiresAt'>;

export type Variables = {
  user: AuthUser | null;
  session: AuthSession | null;
  userRef: UserRef | null;
};

export type Message = {
  op: string;
  data: any;
};
