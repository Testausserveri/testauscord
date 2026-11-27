import { prisma } from '../db';
import { ChannelType } from '../generated/prisma/client';
import { eventBus } from '../realtime/bus';
import type { MessageDTO } from '../realtime/protocol';
import { generateId } from '../utils/utils';

type MessageRecord = {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  format: 'TEXT' | 'E2EE';
  createdAt: Date;
  sender: { username: string; displayName: string | null; avatarVersion: number | null };
};

const isUniqueConstraintError = (error: unknown): boolean => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
};

export const toMessageDto = (message: MessageRecord): MessageDTO => ({
  id: message.id,
  channelId: message.channelId,
  content: message.content,
  format: message.format,
  sender: {
    id: message.senderId,
    username: message.sender.username,
    displayName: message.sender.displayName,
    avatarVersion: message.sender.avatarVersion,
  },
  createdAt: message.createdAt.toISOString(),
});

export const buildMessagePage = <T extends { id: string }>(rows: T[], limit: number): { page: T[]; nextCursor: string | null } => {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
};

const publishDmCreateOnFirstMessage = async (channelId: string) => {
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, type: ChannelType.DM },
    select: {
      members: { select: { userId: true } },
      _count: { select: { messages: true } },
    },
  });

  if (!channel || channel._count.messages !== 1) return;

  await prisma.channelMember.updateMany({
    where: { channelId },
    data: { dmVisible: true },
  });

  eventBus.publish({ type: 'DM_CREATE', channelId, recipientIds: channel.members.map((member) => member.userId) });
};

export const createChannelMessage = async (input: { channelId: string; senderId: string; content: string; clientNonce: string }) => {
  const { channelId, senderId, content, clientNonce } = input;

  const existing = await prisma.message.findUnique({
    where: {
      channelId_senderId_clientNonce: {
        channelId,
        senderId,
        clientNonce,
      },
    },
    include: {
      sender: {
        select: { username: true, displayName: true, avatarVersion: true },
      },
    },
  });

  if (existing) {
    return { message: toMessageDto(existing), created: false };
  }

  try {
    const message = await prisma.message.create({
      data: {
        id: generateId(),
        channelId,
        senderId,
        content,
        clientNonce,
      },
      include: {
        sender: {
          select: { username: true, displayName: true, avatarVersion: true },
        },
      },
    });

    const dto = toMessageDto(message);
    eventBus.publish({ type: 'MESSAGE_CREATE', channelId, message: dto });
    await publishDmCreateOnFirstMessage(channelId);

    return { message: dto, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const duplicate = await prisma.message.findUnique({
      where: {
        channelId_senderId_clientNonce: {
          channelId,
          senderId,
          clientNonce,
        },
      },
      include: {
        sender: {
          select: { username: true, displayName: true, avatarVersion: true },
        },
      },
    });

    if (!duplicate) throw error;

    return { message: toMessageDto(duplicate), created: false };
  }
};
