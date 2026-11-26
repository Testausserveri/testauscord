import type { Server, ServerCategory, ServerLayoutGroup, ServerLayoutPayload } from '@/types/types';

export type ServerLayout = {
  categories: ServerCategory[];
  groups: ServerLayoutGroup[];
};

const channelId = (id: string) => (id.startsWith('channel:') ? id.slice('channel:'.length) : id);
const categoryId = (id: string) => (id.startsWith('category:') ? id.slice('category:'.length) : id);
const groupCategoryId = (id: string) => (id === 'group:null' ? null : id.slice('group:'.length));

export const groupServer = (server: Pick<Server, 'categories' | 'channels'>): ServerLayout => {
  const categories = [...server.categories].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const channels = [...server.channels].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const channelIds = (categoryId: string | null) => channels.filter((channel) => channel.categoryId === categoryId).map((channel) => channel.id);

  return {
    categories,
    groups: [{ categoryId: null, channelIds: channelIds(null) }, ...categories.map((category) => ({ categoryId: category.id, channelIds: channelIds(category.id) }))],
  };
};

export const moveChannel = (groups: ServerLayoutGroup[], activeId: string, overId: string): ServerLayoutGroup[] => {
  const active = channelId(activeId);
  const from = groups.findIndex((group) => group.channelIds.includes(active));
  if (from === -1) return groups;

  const next = groups.map((group) => ({ ...group, channelIds: [...group.channelIds] }));

  if (overId.startsWith('group:')) {
    const to = groups.findIndex((group) => group.categoryId === groupCategoryId(overId));
    if (to === -1) return groups;

    next[from].channelIds = next[from].channelIds.filter((id) => id !== active);
    next[to].channelIds.push(active);
    return next;
  }

  const over = channelId(overId);
  if (over === active) return groups;

  const to = groups.findIndex((group) => group.channelIds.includes(over));
  if (to === -1) return groups;

  if (from === to) {
    const ids = next[from].channelIds;
    const oldIndex = ids.indexOf(active);
    const newIndex = ids.indexOf(over);
    ids.splice(oldIndex, 1);
    ids.splice(newIndex, 0, active);
    return next;
  }

  next[from].channelIds = next[from].channelIds.filter((id) => id !== active);
  next[to].channelIds.splice(next[to].channelIds.indexOf(over), 0, active);
  return next;
};

export const moveCategory = (categories: ServerCategory[], activeId: string, overId: string): ServerCategory[] => {
  const active = categoryId(activeId);
  const over = categoryId(overId);
  const from = categories.findIndex((category) => category.id === active);
  const to = categories.findIndex((category) => category.id === over);
  if (from === -1 || to === -1 || from === to) return categories;

  const next = [...categories];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

export const toLayoutPayload = (groups: ServerLayoutGroup[]): ServerLayoutPayload => ({
  categories: groups.flatMap((group) => (group.categoryId === null ? [] : [group.categoryId])),
  groups,
});
