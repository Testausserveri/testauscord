import type React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { DmsSidebar } from '@/components/DmsSidebar';
import { SidebarInset } from '@/components/ui/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <DmsSidebar />
        <SidebarInset>{children}</SidebarInset>
      </div>
    </SidebarProvider>
  );
}
