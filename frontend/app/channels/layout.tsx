'use client';

import type React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { DmsSidebar } from '@/components/DmsSidebar';
import { SidebarInset } from '@/components/ui/sidebar';
import { WebSocketProvider } from '@/contexts/WebSocketContext';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <WebSocketProvider>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <DmsSidebar />
          <SidebarInset>{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </WebSocketProvider>
  );
}
