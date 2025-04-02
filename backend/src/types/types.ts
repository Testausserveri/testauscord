import type { User, Session } from '@prisma/client';

export type Variables = {
  user: User | null;
  session: Session | null;
};
