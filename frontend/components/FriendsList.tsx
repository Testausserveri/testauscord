'use client';

import type React from 'react';
import { Users } from 'lucide-react';
import { FriendCard } from './FriendCard';
import { useQuery } from '@tanstack/react-query';
import { getFriends } from '@/api/api';
import { Friend } from '@/types/types';

export function FriendsList() {
  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b flex items-center">
        <div className="flex items-center gap-2">
          <Users className="!h-6 !w-6" />
          <h1 className="font-semibold">Friends</h1>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-xs font-semibold mb-2">ALL FRIENDS — {data?.length}</h3>

        <div className="gap-1 flex flex-col">
          {data?.map((friend: Friend) => (
            <FriendCard key={friend.id} name={friend.friend.username} id={friend.friend.id} avatar="" />
          ))}
        </div>
      </div>
    </div>
  );
}
