'use client';

import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDms } from '@/api/api';
import { DmConversation } from '@/types/types';
import { UserAvatar } from './UserAvatar';
import { notFound } from 'next/navigation';
import Loader from './Loader';
import { ChannelChat } from './ChannelChat';

export function DirectMessage({ id }: { id: string }) {
  const { data, isPending, isStale, isError } = useQuery<DmConversation[]>({
    queryKey: ['dms'],
    queryFn: getDms,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  const dm = data?.find((entry) => entry.channelId === id);
  if (!dm && isStale && !isError) return <Loader />;
  if (!dm) return notFound();

  const name = dm.user.displayName ?? dm.user.username;

  return (
    <ChannelChat
      channelId={id}
      placeholder={`Message ${name}...`}
      header={
        <div data-avatar-hover className="flex items-center gap-2">
          <UserAvatar user={dm.user} className="h-8 w-8" />
          <h1 className="font-semibold">{name}</h1>
        </div>
      }
    />
  );
}
