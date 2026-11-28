'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { getDms, getPendingRequests } from '@/api/api';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { DmConversation, IncomingFriendRequest } from '@/types/types';
import { useQuery } from '@tanstack/react-query';
import { UserAvatar } from './UserAvatar';
import { UserPanel } from './UserPanel';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
const navItems = [
  {
    title: 'Friends',
    icon: Users,
    href: '/channels/@me',
  },
];

export function DmsSidebar() {
  const pathname = usePathname();
  const { state } = useSidebar();

  const { data } = useQuery<DmConversation[]>({
    queryKey: ['dms'],
    queryFn: getDms,
    staleTime: 1000 * 20,
  });

  const { data: pending } = useQuery<IncomingFriendRequest[]>({
    queryKey: ['friend-requests-pending'],
    queryFn: getPendingRequests,
    staleTime: 1000 * 20,
  });

  const pendingCount = pending?.length ?? 0;

  return (
    <Sidebar style={{ left: state === 'expanded' ? SERVER_RAIL_WIDTH : `calc(${SERVER_RAIL_WIDTH}px - var(--sidebar-width))` }}>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href} className="py-5">
                      <item.icon className="h-6! w-6!" />
                      <span>{item.title}</span>
                      {pendingCount > 0 && (
                        <span
                          aria-label={`${pendingCount} pending friend requests`}
                          className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
                        >
                          {pendingCount > 9 ? '9+' : pendingCount}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Direct Messages</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {data?.map((dm) => (
                <SidebarMenuItem key={dm.channelId}>
                  <SidebarMenuButton asChild isActive={pathname === `/channels/@me/${dm.channelId}`}>
                    <Link href={`/channels/@me/${dm.channelId}`} data-avatar-hover className="py-5">
                      <UserAvatar user={dm.user} showStatus status={dm.user.status} className="h-8 w-8 mr-3" />
                      <div className="flex-1">
                        <p className="font-semibold">{dm.user.displayName ?? dm.user.username}</p>
                      </div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            {data?.length === 0 && <p className="px-2 py-1 text-sm text-muted-foreground">No direct messages yet. Message someone from a server.</p>}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <UserPanel className="md:hidden" />
    </Sidebar>
  );
}
