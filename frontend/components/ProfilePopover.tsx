'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getFriends, getPendingRequests, getSentRequests, getUser, getUserProfile } from '@/api/api';
import type { CurrentUser, Friend, IncomingFriendRequest, OutgoingFriendRequest, ProfileDTO } from '@/types/types';
import { Button } from './ui/button';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { UserAvatar } from './UserAvatar';

export type ProfileTarget = {
  userId: string;
  anchor: HTMLElement;
};

type Props = {
  target: ProfileTarget | null;
  onClose: () => void;
  onEditProfile: () => void;
};

export function ProfilePopover({ target, onClose, onEditProfile }: Props) {
  const router = useRouter();
  const open = Boolean(target);
  const userId = target?.userId ?? null;
  const anchorRef = useMemo(() => ({ current: target?.anchor ?? null }), [target?.anchor]);

  const { data: currentUser } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  const {
    data: profile,
    isPending,
    isError,
  } = useQuery<ProfileDTO>({
    queryKey: ['profile', userId],
    queryFn: () => getUserProfile(userId!),
    enabled: open,
    staleTime: 1000 * 20,
    retry: false,
  });

  const { data: friends } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn: getFriends,
    enabled: open,
    staleTime: 1000 * 20,
  });

  const { data: incoming } = useQuery<IncomingFriendRequest[]>({
    queryKey: ['friend-requests-pending'],
    queryFn: getPendingRequests,
    enabled: open,
    staleTime: 1000 * 20,
  });

  const { data: outgoing } = useQuery<OutgoingFriendRequest[]>({
    queryKey: ['friend-requests-sent'],
    queryFn: getSentRequests,
    enabled: open,
    staleTime: 1000 * 20,
  });

  const isSelf = Boolean(profile && currentUser && profile.id === currentUser.id);
  const friendship = profile ? friends?.find((entry) => entry.friend.id === profile.id) : undefined;
  const isOutgoing = profile ? outgoing?.some((entry) => entry.receiver.id === profile.id) : false;
  const isIncoming = profile ? incoming?.some((entry) => entry.sender.id === profile.id) : false;

  const openDm = () => {
    if (!friendship) return;

    onClose();
    router.push(`/channels/@me/${friendship.id}`);
  };

  const respondFromFriends = () => {
    onClose();
    router.push('/channels/@me');
  };

  const hasActions = !isSelf && Boolean(friendship || isOutgoing || isIncoming);

  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      {target && <PopoverAnchor virtualRef={anchorRef} />}
      {target && (
        <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="w-80 p-0">
          {isPending ? (
            <p className="p-4 text-sm text-muted-foreground">Loading profile...</p>
          ) : isError || !profile ? (
            <p className="p-4 text-sm text-muted-foreground">Profile unavailable.</p>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4">
                <UserAvatar user={profile} className="h-14 w-14" />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{profile.displayName ?? profile.username}</p>
                  <p className="truncate text-xs text-muted-foreground">@{profile.username}</p>
                </div>
              </div>

              <div className="border-t px-4 py-3">
                <p className="whitespace-pre-wrap break-words text-sm">{profile.bio ?? 'No bio yet.'}</p>
              </div>

              {(isSelf || hasActions) && (
                <div className="flex justify-end gap-2 border-t p-3">
                  {isSelf ? (
                    <Button type="button" onClick={onEditProfile}>
                      Edit profile
                    </Button>
                  ) : friendship ? (
                    <Button type="button" onClick={openDm}>
                      Message
                    </Button>
                  ) : isOutgoing ? (
                    <Button type="button" variant="secondary" disabled>
                      Request pending
                    </Button>
                  ) : (
                    <Button type="button" onClick={respondFromFriends}>
                      Respond from Friends
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
