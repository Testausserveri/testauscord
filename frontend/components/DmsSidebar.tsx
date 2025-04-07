'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { getFriends } from '@/api/api';
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from '@/components/ui/sidebar';
import { Friend } from '@/types/types';
import { useQuery } from '@tanstack/react-query';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';

const navItems = [
  {
    title: 'Friends',
    icon: Users,
    href: '/channels/@me',
  },
];

export function DmsSidebar() {
  const pathname = usePathname();

  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href} className="py-5">
                      <item.icon className="!h-6 !w-6" />
                      <span>{item.title}</span>
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
              {data?.map((friend: Friend) => (
                <SidebarMenuItem key={friend.friend.id}>
                  <SidebarMenuButton asChild isActive={pathname === `/channels/@me/${friend.friend.id}`}>
                    <Link href={`/channels/@me/${friend.friend.id}`} className="py-5">
                      <div className="relative mr-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src="" alt={friend.friend.username} />
                          <AvatarFallback className="bg-[#2b2d31]">
                            {friend.friend.username.charAt(0)}
                            {friend.friend.username.split(' ')[1]?.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold">{friend.friend.username}</p>
                      </div>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
