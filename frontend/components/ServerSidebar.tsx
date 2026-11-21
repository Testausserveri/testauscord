'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Hash } from 'lucide-react';
import { getServers } from '@/api/api';
import { Server } from '@/types/types';
import { getServerRoute } from '@/lib/serverRoutes';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';

export function ServerSidebar() {
  const pathname = usePathname();
  const route = getServerRoute(pathname);
  const { state } = useSidebar();

  const { data } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: getServers,
    staleTime: 1000 * 20,
  });

  const server = data?.find((item) => item.id === route?.serverId);

  return (
    <Sidebar style={state === 'expanded' ? { left: SERVER_RAIL_WIDTH } : undefined}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{server?.name ?? 'Server'}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {server?.channels.map((channel) => (
                <SidebarMenuItem key={channel.id}>
                  <SidebarMenuButton asChild isActive={route?.channelId === channel.id}>
                    <Link href={`/channels/${server.id}/${channel.id}`} className="py-4">
                      <Hash className="!h-5 !w-5" />
                      <span>{channel.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
