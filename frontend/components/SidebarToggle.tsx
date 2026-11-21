'use client';

import { useSidebar } from '@/components/ui/sidebar';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';

export function SidebarToggle() {
  const { state, toggleSidebar } = useSidebar();
  const expanded = state === 'expanded';

  return (
    <button
      type="button"
      aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      aria-expanded={expanded}
      title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      tabIndex={-1}
      onClick={toggleSidebar}
      className="after:bg-sidebar-border hover:after:bg-sidebar-ring fixed inset-y-0 z-30 hidden w-2 -translate-x-1/2 transition-[left] duration-200 ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:transition-colors md:block"
      style={{ left: expanded ? `calc(${SERVER_RAIL_WIDTH}px + var(--sidebar-width))` : SERVER_RAIL_WIDTH }}
    />
  );
}
