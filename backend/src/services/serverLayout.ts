export type LayoutChannel = {
  id: string;
  categoryId: string | null;
  position: number;
};

export type ChannelPlacement = {
  id: string;
  categoryId: string | null;
  position: number;
};

const byPosition = (a: LayoutChannel, b: LayoutChannel) => a.position - b.position || a.id.localeCompare(b.id);

export const nextPosition = (positions: number[]): number => (positions.length === 0 ? 0 : Math.max(...positions) + 1);

export const planChannelAssign = (channels: LayoutChannel[], channelId: string, categoryId: string | null): ChannelPlacement[] => {
  const moving = channels.find((channel) => channel.id === channelId);
  if (!moving || moving.categoryId === categoryId) return [];

  const source = channels.filter((channel) => channel.categoryId === moving.categoryId && channel.id !== channelId).sort(byPosition);
  const target = channels.filter((channel) => channel.categoryId === categoryId && channel.id !== channelId).sort(byPosition);

  return [
    ...source.map((channel, index) => ({ id: channel.id, categoryId: moving.categoryId, position: index })),
    ...target.map((channel, index) => ({ id: channel.id, categoryId, position: index })),
    { id: channelId, categoryId, position: target.length },
  ];
};

export const planCategoryDelete = (channels: LayoutChannel[], categoryId: string): ChannelPlacement[] => {
  const uncategorized = channels.filter((channel) => channel.categoryId === null).sort(byPosition);
  const affected = channels.filter((channel) => channel.categoryId === categoryId).sort(byPosition);

  return [...uncategorized, ...affected].map((channel, index) => ({ id: channel.id, categoryId: null, position: index }));
};
