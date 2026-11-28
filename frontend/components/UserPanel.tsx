'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { getUser, updatePresence } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { presenceDotClass, presenceLabel } from '@/lib/presence';
import { cn } from '@/lib/utils';
import type { CurrentUser, PresenceStatus } from '@/types/types';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu';
import { SidebarFooter } from './ui/sidebar';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';

const STATUS_OPTIONS: PresenceStatus[] = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'];

export function UserPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const [updating, setUpdating] = useState(false);

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return null;

  const setStatus = async (status: PresenceStatus) => {
    if (updating || status === user.presenceStatus) return;

    setUpdating(true);
    try {
      const { presenceStatus } = await updatePresence(status);
      queryClient.setQueryData<CurrentUser>(['user'], (current) => (current ? { ...current, presenceStatus, status: presenceStatus === 'INVISIBLE' ? 'OFFLINE' : presenceStatus } : current));
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SidebarFooter>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-avatar-hover
              title="Set status"
              aria-label="Set status"
              className="flex shrink-0 items-center gap-0.5 rounded-md p-2 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <UserAvatar user={user} showStatus status={user.presenceStatus === 'INVISIBLE' ? 'INVISIBLE' : user.status} className="h-8 w-8" />
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {STATUS_OPTIONS.map((status) => (
              <DropdownMenuItem key={status} onSelect={() => void setStatus(status)} disabled={updating} className="gap-2">
                <span className={cn('size-2.5 rounded-full', presenceDotClass(status))} />
                <span>{presenceLabel(status)}</span>
                {user.presenceStatus === status && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={(event) => openProfile(user.id, event.currentTarget)}
          title="Your profile"
          className="flex min-w-0 flex-1 items-center rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
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
