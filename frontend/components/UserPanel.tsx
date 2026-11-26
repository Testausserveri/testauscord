'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Settings } from 'lucide-react';
import { getUser } from '@/api/api';
import type { CurrentUser } from '@/types/types';
import { Button } from './ui/button';
import { SidebarFooter } from './ui/sidebar';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';

export function UserPanel() {
  const router = useRouter();
  const { openProfile } = useProfilePopover();

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return null;

  return (
    <SidebarFooter>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={(event) => openProfile(user.id, event.currentTarget)}
          title="Your profile"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <UserAvatar user={user} className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.displayName ?? user.username}</p>
            <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
          </div>
        </button>
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push('/channels/@me/settings')} title="Settings" aria-label="Settings">
          <Settings />
        </Button>
      </div>
    </SidebarFooter>
  );
}
