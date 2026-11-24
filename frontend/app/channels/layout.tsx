'use client';

import type React from 'react';
import { usePathname } from 'next/navigation';
import { SidebarProvider } from '@/components/ui/sidebar';
import { DmsSidebar } from '@/components/DmsSidebar';
import { ServerRail } from '@/components/ServerRail';
import { ServerSidebar } from '@/components/ServerSidebar';
import { SidebarToggle } from '@/components/SidebarToggle';
import { SidebarInset } from '@/components/ui/sidebar';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { ServerMembershipEvents } from '@/components/ServerMembershipEvents';
import { UserEvents } from '@/components/UserEvents';
import { FriendEvents } from '@/components/FriendEvents';
import { ProfilePopoverProvider } from '@/components/ProfilePopoverProvider';
import { getServerRoute } from '@/lib/serverRoutes';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isServerRoute = getServerRoute(pathname) !== null;

  return (
    <WebSocketProvider>
      <ProfilePopoverProvider>
        <ServerMembershipEvents />
        <UserEvents />
        <FriendEvents />
        <SidebarProvider>
          <div className="flex h-screen w-full">
            <ServerRail />
            {isServerRoute ? <ServerSidebar /> : <DmsSidebar />}
            <SidebarToggle />
            <SidebarInset>{children}</SidebarInset>
          </div>
        </SidebarProvider>
      </ProfilePopoverProvider>
    </WebSocketProvider>
  );
}
