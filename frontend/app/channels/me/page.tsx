'use client';

import { getFriends } from '@/api/api';
import { FriendsList } from '@/components/FriendsList';
import Loader from '@/components/Loader';
import { useQuery } from '@tanstack/react-query';

export default function Me() {
  const { isPending } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  return <FriendsList />;
}
