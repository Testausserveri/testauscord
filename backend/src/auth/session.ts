import type { Session } from '../generated/prisma/client';
import { prisma } from '../db';
import { closeSessionConnections } from '../realtime/connections';
import type { AuthSession, AuthUser } from '../types/types';
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

export const MAX_SESSIONS_PER_USER = 20;

export const createSession = async (token: string, userId: string, userAgent?: string): Promise<Session> => {
  const session: Session = {
    id: hashSessionToken(token),
    userId,
    userAgent: userAgent ?? null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  };

  const evicted = await prisma.$transaction(async (tx) => {
    await tx.session.create({
      data: session,
    });

    const stale = await tx.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
      skip: MAX_SESSIONS_PER_USER,
    });

    if (stale.length === 0) return [];

    const ids = stale.map((row) => row.id);

    await tx.session.deleteMany({
      where: { id: { in: ids } },
    });

    return ids;
  });

  for (const id of evicted) {
    closeSessionConnections(id);
  }

  return session;
};

export const getSession = async (sessionId: string): Promise<{ expiresAt: Date } | null> => {
  return prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    select: {
      expiresAt: true,
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
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      user: {
        select: {
          id: true,
          username: true,
        },
      },
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

export type SessionValidationResult = { session: AuthSession; user: AuthUser } | { session: null; user: null };
