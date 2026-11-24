'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { getServerRoute } from '@/lib/serverRoutes';
import type { Server, ServerDetail } from '@/types/types';

export function ServerMembershipEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type === 'SERVER_MEMBER_REMOVED') {
          const serverId = (frame.data as { serverId?: unknown } | undefined)?.serverId;
          if (typeof serverId !== 'string') return;

          const removed = queryClient.getQueryData<Server[]>(['servers'])?.find((server) => server.id === serverId);
          if (removed) {
            for (const channel of removed.channels) {
              queryClient.removeQueries({ queryKey: ['messages', channel.id] });
            }
          }

          queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.filter((server) => server.id !== serverId));
          queryClient.removeQueries({ queryKey: ['server', serverId] });
          queryClient.removeQueries({ queryKey: ['server-invites', serverId] });
          void queryClient.invalidateQueries({ queryKey: ['servers'] });

          if (getServerRoute(pathname)?.serverId === serverId) {
            router.push('/channels/@me');
          }

          return;
        }

        if (frame.type === 'SERVER_UPDATED') {
          const data = frame.data as { server?: { id?: unknown; name?: unknown } } | undefined;
          const serverId = data?.server?.id;
          const name = data?.server?.name;
          if (typeof serverId !== 'string' || typeof name !== 'string') return;

          queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((server) => (server.id === serverId ? { ...server, name } : server)));
          queryClient.setQueryData<ServerDetail>(['server', serverId], (detail) => (detail ? { ...detail, name } : detail));
        }
      }),
    [addListener, pathname, queryClient, router],
  );

  return null;
}
