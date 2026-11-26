export type LayoutCategory = {
  id: string;
  position: number;
};

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

export type LayoutGroup = {
  categoryId: string | null;
  channelIds: string[];
};

export type LayoutPayload = {
  categories: string[];
  groups: LayoutGroup[];
};

export type LayoutPlan = {
  categories: { id: string; position: number }[];
  channels: ChannelPlacement[];
};

const byPosition = (a: LayoutChannel, b: LayoutChannel) => a.position - b.position || a.id.localeCompare(b.id);

export const nextPosition = (positions: number[]): number => (positions.length === 0 ? 0 : Math.max(...positions) + 1);

export const planLayout = (categories: LayoutCategory[], channels: LayoutChannel[], payload: LayoutPayload): LayoutPlan | null => {
  const categoryIds = new Set(categories.map((category) => category.id));
  if (payload.categories.length !== categoryIds.size) return null;

  const orderedCategoryIds = new Set(payload.categories);
  if (orderedCategoryIds.size !== payload.categories.length || payload.categories.some((id) => !categoryIds.has(id))) return null;

  if (payload.groups.length !== categories.length + 1) return null;

  const groups = new Map<string | null, string[]>();
  for (const group of payload.groups) {
    if (groups.has(group.categoryId)) return null;
    groups.set(group.categoryId, group.channelIds);
  }

  if (!groups.has(null) || categories.some((category) => !groups.has(category.id))) return null;

  const channelIds = new Set(channels.map((channel) => channel.id));
  const seen = new Set<string>();

  for (const channelIdsInGroup of groups.values()) {
    for (const channelId of channelIdsInGroup) {
      if (!channelIds.has(channelId) || seen.has(channelId)) return null;
      seen.add(channelId);
    }
  }

  if (seen.size !== channels.length) return null;

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryUpdates = payload.categories.flatMap((id, position) => (categoryById.get(id)!.position === position ? [] : [{ id, position }]));

  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const channelUpdates: ChannelPlacement[] = [];

  for (const group of payload.groups) {
    group.channelIds.forEach((channelId, position) => {
      const current = channelById.get(channelId)!;
      if (current.categoryId !== group.categoryId || current.position !== position) {
        channelUpdates.push({ id: channelId, categoryId: group.categoryId, position });
      }
    });
  }

  return { categories: categoryUpdates, channels: channelUpdates };
};

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
