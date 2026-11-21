'use client';

import type React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFriends } from '@/api/api';
import { Friend } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
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

  return (
    <ChannelChat
      channelId={id}
      placeholder={`Message ${friend.username}...`}
      header={
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={''} alt={friend.username} />
            <AvatarFallback className="bg-muted">
              {friend.username.charAt(0)}
              {friend.username.split(' ')[1]?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <h1 className="font-semibold">{friend.username}</h1>
        </div>
      }
    />
  );
}
