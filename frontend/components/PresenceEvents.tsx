'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { CurrentUser, DmConversation, EffectivePresence, Friend, PresenceStatus, ProfileDTO, ServerDetail } from '@/types/types';

const PRESENCE_STATUSES: PresenceStatus[] = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'];
const EFFECTIVE_STATUSES: EffectivePresence[] = ['ONLINE', 'IDLE', 'DND', 'OFFLINE'];

const isPresenceStatus = (value: unknown): value is PresenceStatus => PRESENCE_STATUSES.includes(value as PresenceStatus);
const isEffectivePresence = (value: unknown): value is EffectivePresence => EFFECTIVE_STATUSES.includes(value as EffectivePresence);

export function PresenceEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type === 'PRESENCE_SELF_UPDATE') {
          const presenceStatus = (frame.data as { presenceStatus?: unknown } | undefined)?.presenceStatus;
          if (!isPresenceStatus(presenceStatus)) return;

          queryClient.setQueryData<CurrentUser>(['user'], (current) => (current ? { ...current, presenceStatus, status: presenceStatus === 'INVISIBLE' ? 'OFFLINE' : presenceStatus } : current));
          return;
        }

        if (frame.type !== 'PRESENCE_UPDATE') return;

        const data = frame.data as { userId?: unknown; status?: unknown } | undefined;
        const userId = data?.userId;
        const status = data?.status;
        if (typeof userId !== 'string' || !isEffectivePresence(status)) return;

        queryClient.setQueriesData<ServerDetail>({ queryKey: ['server'] }, (detail) => {
          if (!detail?.members.some((member) => member.id === userId)) return detail;
          return { ...detail, members: detail.members.map((member) => (member.id === userId ? { ...member, status } : member)) };
        });

        queryClient.setQueryData<Friend[]>(['friends'], (friends) => {
          if (!friends?.some((entry) => entry.friend.id === userId)) return friends;
          return friends.map((entry) => (entry.friend.id === userId ? { ...entry, friend: { ...entry.friend, status } } : entry));
        });

        queryClient.setQueryData<DmConversation[]>(['dms'], (dms) => {
          if (!dms?.some((entry) => entry.user.id === userId)) return dms;
          return dms.map((entry) => (entry.user.id === userId ? { ...entry, user: { ...entry.user, status } } : entry));
        });

        queryClient.setQueryData<ProfileDTO>(['profile', userId], (profile) => (profile ? { ...profile, status } : profile));
      }),
    [addListener, queryClient],
  );

  return null;
}
