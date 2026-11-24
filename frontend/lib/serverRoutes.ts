import type { Server } from '@/types/types';

type ServerRoute = {
  serverId: string;
  channelId: string | null;
};

export const getServerRoute = (pathname: string): ServerRoute | null => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'channels') return null;

  const serverId = segments[1];
  if (!serverId || serverId === 'me' || serverId === '@me') return null;

  return { serverId, channelId: segments[2] ?? null };
};

export const firstChannel = (server: Server) => {
  const channels = [...server.channels].sort((a, b) => a.position - b.position);

  const uncategorized = channels.find((channel) => (channel.categoryId ?? null) === null);
  if (uncategorized) return uncategorized;

  for (const category of server.categories ?? []) {
    const channel = channels.find((entry) => entry.categoryId === category.id);
    if (channel) return channel;
  }

  return undefined;
};
