'use client';

import { getFriends } from '@/api/api';
import { FriendsList } from '@/components/FriendsList';
import Loader from '@/components/Loader';
import { useQuery } from '@tanstack/react-query';
import { notFound, useParams } from 'next/navigation';

export default function Channels() {
  const params = useParams();

  if (decodeURIComponent(String(params.slug)) !== '@me') {
    notFound();
  }

  const { isPending } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  return <FriendsList />;
}
