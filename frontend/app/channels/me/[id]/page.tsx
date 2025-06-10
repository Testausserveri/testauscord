'use client';

import { getFriends } from '@/api/api';
import { DirectMessage } from '@/components/DirectMessage';
import Loader from '@/components/Loader';
import { useQuery } from '@tanstack/react-query';
import { notFound, useParams } from 'next/navigation';

export default function DirectMessages() {
  const params = useParams();

  const { isPending } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;

  if (!params.id) return notFound();

  return <DirectMessage id={params.id.toString()} />;
}
