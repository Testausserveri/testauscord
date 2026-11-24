'use client';

import { MoreHorizontal, Phone, Video } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { useProfilePopover } from '@/components/ProfilePopoverProvider';
import { UserAvatar } from '@/components/UserAvatar';
import type { Friend } from '@/types/types';

export function FriendCard({ friend }: { friend: Friend }) {
  const { openProfile } = useProfilePopover();
  const name = friend.friend.displayName ?? friend.friend.username;

  return (
    <div className="rounded-lg p-3 flex items-center hover:bg-accent">
      <Link href={`/channels/@me/${friend.id}`} className="flex flex-1 items-center min-w-0">
        <UserAvatar user={friend.friend} className="h-8 w-8 mr-3" />
        <p className="font-semibold truncate">{name}</p>
      </Link>
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent">
          <Video className="h-5 w-5 " />
          <span className="sr-only">Video Call</span>
        </Button>
        <Button size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent">
          <Phone className="h-5 w-5 " />
          <span className="sr-only">Voice Call</span>
        </Button>
        <Button type="button" size="icon" variant="ghost" className="rounded-full h-9 w-9 bg-muted hover:bg-accent" onClick={(event) => openProfile(friend.friend.id, event.currentTarget)}>
          <MoreHorizontal className="h-5 w-5 " />
          <span className="sr-only">More Options</span>
        </Button>
      </div>
    </div>
  );
}
