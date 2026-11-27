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
import { DmEvents } from '@/components/DmEvents';
import { ProfilePopoverProvider } from '@/components/ProfilePopoverProvider';
import { getServerRoute } from '@/lib/serverRoutes';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const serverRoute = getServerRoute(pathname);
  const isServerRoute = serverRoute !== null;
  const isAccountSettingsRoute = pathname === '/channels/me/settings' || pathname === '/channels/@me/settings';
  const isSettingsRoute = isAccountSettingsRoute || serverRoute?.channelId === 'settings';

  return (
    <WebSocketProvider>
      <ProfilePopoverProvider>
        <ServerMembershipEvents />
        <UserEvents />
        <FriendEvents />
        <DmEvents />
        <SidebarProvider>
          <div className="flex h-screen w-full">
            <ServerRail />
            {isSettingsRoute ? null : isServerRoute ? <ServerSidebar /> : <DmsSidebar />}
            {!isSettingsRoute && <SidebarToggle />}
            <SidebarInset>{children}</SidebarInset>
          </div>
        </SidebarProvider>
      </ProfilePopoverProvider>
    </WebSocketProvider>
  );
}
