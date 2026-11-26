'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { getFriends, getPendingRequests } from '@/api/api';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Friend, IncomingFriendRequest } from '@/types/types';
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

  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  const { data: pending } = useQuery<IncomingFriendRequest[]>({
    queryKey: ['friend-requests-pending'],
    queryFn: getPendingRequests,
    staleTime: 1000 * 20,
  });

  const friends = data ? [...data].sort((a, b) => (a.friend.displayName ?? a.friend.username).localeCompare(b.friend.displayName ?? b.friend.username)) : undefined;
  const pendingCount = pending?.length ?? 0;

  return (
    <Sidebar style={state === 'expanded' ? { left: SERVER_RAIL_WIDTH } : undefined}>
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
              {friends?.map((friend: Friend) => (
                <SidebarMenuItem key={friend.friend.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/channels/@me/${friend.id}`}>
                    <Link href={`/channels/@me/${friend.id}`} className="py-5">
                      <UserAvatar user={friend.friend} className="h-8 w-8 mr-3" />
                      <div className="flex-1">
                        <p className="font-semibold">{friend.friend.displayName ?? friend.friend.username}</p>
                      </div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <UserPanel />
    </Sidebar>
  );
}
