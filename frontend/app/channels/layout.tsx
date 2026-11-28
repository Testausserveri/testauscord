'use client';

import type React from 'react';
import { usePathname } from 'next/navigation';
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import { DmsSidebar } from '@/components/DmsSidebar';
import { ServerRail } from '@/components/ServerRail';
import { ServerSidebar } from '@/components/ServerSidebar';
import { SidebarToggle } from '@/components/SidebarToggle';
import { SidebarInset } from '@/components/ui/sidebar';
import { UserPanel } from '@/components/UserPanel';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { ServerMembershipEvents } from '@/components/ServerMembershipEvents';
import { UserEvents } from '@/components/UserEvents';
import { PresenceEvents } from '@/components/PresenceEvents';
import { FriendEvents } from '@/components/FriendEvents';
import { DmEvents } from '@/components/DmEvents';
import { ProfilePopoverProvider } from '@/components/ProfilePopoverProvider';
import { getServerRoute } from '@/lib/serverRoutes';

function DockedUserPanel() {
  const { state } = useSidebar();
  const expanded = state === 'expanded';

  return (
    <div
      className="fixed bottom-0 left-0 z-40 hidden overflow-hidden border-t border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-linear md:block"
      style={{ width: expanded ? `calc(${SERVER_RAIL_WIDTH}px + var(--sidebar-width))` : SERVER_RAIL_WIDTH }}
    >
      <UserPanel className="px-2 py-3" compact={!expanded} />
    </div>
  );
}

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
        <PresenceEvents />
        <FriendEvents />
        <DmEvents />
        <SidebarProvider>
          <div className="flex h-screen w-full">
            <ServerRail />
            {isSettingsRoute ? null : isServerRoute ? <ServerSidebar /> : <DmsSidebar />}
            {!isSettingsRoute && <SidebarToggle />}
            {!isSettingsRoute && <DockedUserPanel />}
            <SidebarInset>{children}</SidebarInset>
          </div>
        </SidebarProvider>
      </ProfilePopoverProvider>
    </WebSocketProvider>
  );
}
