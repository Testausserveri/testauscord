'use client';

import { Suspense } from 'react';
import { getFriends } from '@/api/api';
import { FriendsPage } from '@/components/FriendsPage';
import Loader from '@/components/Loader';
import { useQuery } from '@tanstack/react-query';

export default function Me() {
  const { isPending } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  return (
    <Suspense fallback={<Loader />}>
      <FriendsPage />
    </Suspense>
  );
}
