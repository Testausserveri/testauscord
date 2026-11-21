import type { User, Session } from '../generated/prisma/client';
import { prisma } from '../db';
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import crypto from 'node:crypto';

export const generateSessionToken = (): string => {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = encodeBase32LowerCaseNoPadding(bytes);
  return token;
};

export const hashSessionToken = (token: string): string => encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

export const createSession = async (token: string, userId: string): Promise<Session> => {
  const session: Session = {
    id: hashSessionToken(token),
    userId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  };

  await prisma.session.create({
    data: session,
  });

  return session;
};

export const getSession = async (sessionId: string): Promise<Session | null> => {
  return prisma.session.findUnique({
    where: {
      id: sessionId,
    },
  });
};

export const validateSessionToken = async (token: string): Promise<SessionValidationResult> => {
  return validateSessionId(hashSessionToken(token));
};

export const validateSessionId = async (sessionId: string): Promise<SessionValidationResult> => {
  const result = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      user: true,
    },
  });

  if (result === null) {
    return { session: null, user: null };
  }

  const { user, ...session } = result;

  if (Date.now() >= session.expiresAt.getTime()) {
    await prisma.session.delete({ where: { id: sessionId } });
    return { session: null, user: null };
  }

  if (Date.now() >= session.expiresAt.getTime() - 1000 * 60 * 60 * 24 * 15) {
    session.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

    await prisma.session.update({
      where: {
        id: session.id,
      },
      data: {
        expiresAt: session.expiresAt,
      },
    });
  }

  return { session, user };
};

export const invalidateSession = async (sessionId: string): Promise<void> => {
  await prisma.session.delete({ where: { id: sessionId } });
};

export const invalidateAllSessions = async (userId: string): Promise<void> => {
  await prisma.session.deleteMany({
    where: {
      userId: userId,
    },
  });
};

export type SessionValidationResult = { session: Session; user: User } | { session: null; user: null };
