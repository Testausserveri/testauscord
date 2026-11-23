import type { User, Session } from '../generated/prisma/client';

export type AuthUser = Pick<User, 'id' | 'username'>;
export type AuthSession = Pick<Session, 'id' | 'userId' | 'expiresAt'>;

export type Variables = {
  user: AuthUser | null;
  session: AuthSession | null;
};

export type Message = {
  op: string;
  data: any;
};
