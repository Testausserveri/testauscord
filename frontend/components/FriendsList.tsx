'use client';

import { FriendCard } from './FriendCard';
import { useQuery } from '@tanstack/react-query';
import { getFriends } from '@/api/api';
import { Friend } from '@/types/types';

export function FriendsList() {
  const { data } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  const friends = data ? [...data].sort((a, b) => (a.friend.displayName ?? a.friend.username).localeCompare(b.friend.displayName ?? b.friend.username)) : undefined;

  return (
    <div>
      <h3 className="text-xs font-semibold mb-2">ALL FRIENDS — {data?.length ?? 0}</h3>

      <div className="gap-1 flex flex-col">
        {friends?.map((friend: Friend) => (
          <FriendCard key={friend.friendshipId} friend={friend} />
        ))}
      </div>
    </div>
  );
}
