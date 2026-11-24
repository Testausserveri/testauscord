'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { CurrentUser, UserRef } from '@/types/types';

export function UserEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type !== 'USER_UPDATED') return;

        const user = (frame.data as { user?: UserRef } | undefined)?.user;
        if (!user || typeof user.id !== 'string') return;

        queryClient.setQueryData<CurrentUser>(['user'], (current) => (current?.id === user.id ? { ...current, username: user.username, displayName: user.displayName } : current));
        void queryClient.invalidateQueries({ queryKey: ['friends'] });
      }),
    [addListener, queryClient],
  );

  return null;
}
