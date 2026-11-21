'use client';

import { Hash } from 'lucide-react';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { getServer } from '@/api/api';
import { ChannelChat } from '@/components/ChannelChat';
import Loader from '@/components/Loader';
import { ServerDetail } from '@/types/types';

export default function ServerChannelPage() {
  const params = useParams();
  const serverId = params.serverId?.toString();
  const channelId = params.channelId?.toString();

  const { data: server, isPending } = useQuery<ServerDetail>({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId!),
    enabled: Boolean(serverId),
    staleTime: 1000 * 20,
  });

  if (isPending) return <Loader />;
  if (!server || !channelId) return notFound();

  const channel = server.channels.find((item) => item.id === channelId);
  if (!channel) return notFound();

  return (
    <ChannelChat
      channelId={channelId}
      placeholder={`Message #${channel.name}`}
      header={
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">{channel.name}</h1>
          <span className="text-sm text-muted-foreground">{server.name}</span>
        </div>
      }
    />
  );
}
