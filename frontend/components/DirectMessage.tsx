'use client';

import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFriends } from '@/api/api';
import { Friend } from '@/types/types';
import { UserAvatar } from './UserAvatar';
import { notFound } from 'next/navigation';
import Loader from './Loader';
import { ChannelChat } from './ChannelChat';

export function DirectMessage({ id }: { id: string }) {
  const { data, isPending } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  const friend = data?.find((f: Friend) => f.id === id)?.friend;
  if (!friend) return notFound();

  const name = friend.displayName ?? friend.username;

  return (
    <ChannelChat
      channelId={id}
      placeholder={`Message ${name}...`}
      header={
        <div className="flex items-center gap-2">
          <UserAvatar user={friend} className="h-8 w-8" />
          <h1 className="font-semibold">{name}</h1>
        </div>
      }
    />
  );
}
