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
