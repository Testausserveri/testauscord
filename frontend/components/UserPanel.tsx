'use client';

import { useQuery } from '@tanstack/react-query';
import { getUser } from '@/api/api';
import type { CurrentUser } from '@/types/types';
import { SidebarFooter } from './ui/sidebar';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';

export function UserPanel() {
  const { openProfile } = useProfilePopover();

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return null;

  return (
    <SidebarFooter>
      <button
        type="button"
        onClick={(event) => openProfile(user.id, event.currentTarget)}
        title="Your profile"
        className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <UserAvatar user={user} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.displayName ?? user.username}</p>
          <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
        </div>
      </button>
    </SidebarFooter>
  );
}
