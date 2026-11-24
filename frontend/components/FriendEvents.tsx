'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { IncomingFriendRequest, OutgoingFriendRequest } from '@/types/types';

export function FriendEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type === 'FRIEND_REQUEST_CREATE') {
          const request = (frame.data as { request?: IncomingFriendRequest } | undefined)?.request;
          if (!request || typeof request.id !== 'string' || !request.sender || typeof request.sender.id !== 'string') return;

          queryClient.setQueryData<IncomingFriendRequest[]>(['friend-requests-pending'], (requests) => {
            if (!requests) return requests;
            if (requests.some((entry) => entry.id === request.id)) return requests;
            return [request, ...requests];
          });

          toast(`${request.sender.displayName ?? request.sender.username} sent you a friend request`);
          return;
        }

        if (frame.type === 'FRIEND_REQUEST_REMOVE') {
          const data = frame.data as { requestId?: unknown; reason?: unknown } | undefined;
          if (!data || typeof data.requestId !== 'string') return;
          const requestId = data.requestId;

          const sentBefore = queryClient.getQueryData<OutgoingFriendRequest[]>(['friend-requests-sent']);
          const wasSent = sentBefore?.some((entry) => entry.id === requestId) ?? false;

          queryClient.setQueryData<IncomingFriendRequest[]>(['friend-requests-pending'], (requests) => requests?.filter((entry) => entry.id !== requestId));
          queryClient.setQueryData<OutgoingFriendRequest[]>(['friend-requests-sent'], (requests) => requests?.filter((entry) => entry.id !== requestId));

          if (data.reason === 'accepted') {
            void queryClient.invalidateQueries({ queryKey: ['friends'] });
            if (wasSent) toast.success('Friend request accepted');
          }
        }
      }),
    [addListener, queryClient],
  );

  return null;
}
