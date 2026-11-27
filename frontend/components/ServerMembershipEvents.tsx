'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { getServerRoute } from '@/lib/serverRoutes';
import type { Server, ServerCategory, ServerChannel, ServerDetail } from '@/types/types';

export function ServerMembershipEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type === 'SERVER_MEMBER_REMOVED') {
          const data = frame.data as { serverId?: unknown; reason?: unknown } | undefined;
          const serverId = data?.serverId;
          if (typeof serverId !== 'string') return;

          const removed = queryClient.getQueryData<Server[]>(['servers'])?.find((server) => server.id === serverId);

          if (data?.reason === 'kick' || data?.reason === 'ban') {
            toast.error(data.reason === 'kick' ? `You were kicked from ${removed?.name ?? 'the server'}` : `You were banned from ${removed?.name ?? 'the server'}`);
          }

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

        if (frame.type === 'SERVER_MEMBER_ADDED') {
          const serverId = (frame.data as { serverId?: unknown } | undefined)?.serverId;
          if (typeof serverId !== 'string') return;

          void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
          return;
        }

        if (frame.type === 'SERVER_LAYOUT_UPDATE') {
          const data = frame.data as { serverId?: unknown; layout?: { categories?: unknown; channels?: unknown } } | undefined;
          const serverId = data?.serverId;
          const layout = data?.layout;
          if (typeof serverId !== 'string' || !layout || !Array.isArray(layout.categories) || !Array.isArray(layout.channels)) return;

          const next = { categories: layout.categories as ServerCategory[], channels: layout.channels as ServerChannel[] };

          queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((server) => (server.id === serverId ? { ...server, ...next } : server)));
          queryClient.setQueryData<ServerDetail>(['server', serverId], (detail) => (detail ? { ...detail, ...next } : detail));
        }

        if (frame.type === 'SERVER_ACCESS_UPDATE') {
          const serverId = (frame.data as { serverId?: unknown } | undefined)?.serverId;
          if (typeof serverId !== 'string') return;

          void queryClient.invalidateQueries({ queryKey: ['servers'] });
          void queryClient.invalidateQueries({ queryKey: ['server', serverId] });
          return;
        }

        if (frame.type === 'SERVER_UPDATED') {
          const data = frame.data as { server?: { id?: unknown; name?: unknown; iconVersion?: unknown } } | undefined;
          const serverId = data?.server?.id;
          const name = data?.server?.name;
          const iconVersion = data?.server?.iconVersion;
          if (typeof serverId !== 'string' || typeof name !== 'string' || (iconVersion !== null && typeof iconVersion !== 'number')) return;

          const patch = { name, iconVersion };

          queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((server) => (server.id === serverId ? { ...server, ...patch } : server)));
          queryClient.setQueryData<ServerDetail>(['server', serverId], (detail) => (detail ? { ...detail, ...patch } : detail));
        }
      }),
    [addListener, pathname, queryClient, router],
  );

  return null;
}
