'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';

export function DmEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type !== 'DM_CREATE') return;

        const channelId = (frame.data as { channelId?: unknown } | undefined)?.channelId;
        if (typeof channelId !== 'string') return;

        void queryClient.invalidateQueries({ queryKey: ['dms'] });
      }),
    [addListener, queryClient],
  );

  return null;
}
