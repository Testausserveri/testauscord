'use client';

import { useRef, useState } from 'react';
import type { ReactNode, SubmitEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, ChevronDown, FolderPlus, Hash, LogOut, Pencil, Plus, Settings, Ticket, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createCategory, createChannel, deleteCategory, getServers, getUser, renameChannel, updateCategory, updateServerLayout } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { CurrentUser, Server, ServerAction, ServerCategory, ServerChannel, ServerDetail, ServerLayoutGroup } from '@/types/types';
import { getServerRoute } from '@/lib/serverRoutes';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { groupServer, moveCategory, moveChannel, toLayoutPayload } from '@/lib/serverLayout';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServerActionDialogs } from '@/components/ServerActionDialogs';
import { UserPanel } from '@/components/UserPanel';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

type CategoryDialog = { mode: 'create' } | { mode: 'rename'; category: ServerCategory } | { mode: 'delete'; category: ServerCategory };

const collapsedKey = (serverId: string) => `sidebar-collapsed:${serverId}`;

const readCollapsed = (serverId: string): Record<string, boolean> => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(collapsedKey(serverId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const orderGroups = (groups: ServerLayoutGroup[], categories: ServerCategory[]) => {
  const byCategory = new Map(groups.map((group) => [group.categoryId, group]));
  return [byCategory.get(null), ...categories.map((category) => byCategory.get(category.id))].filter((group): group is ServerLayoutGroup => group !== undefined);
};

const layoutCollisionDetection: CollisionDetection = (args) => {
  const categoryDrag = String(args.active.id).startsWith('category:');
  const droppableContainers = args.droppableContainers.filter((container) => {
    const id = String(container.id);
    return categoryDrag ? id.startsWith('category:') : id.startsWith('channel:') || id.startsWith('group:');
  });

  if (!args.pointerCoordinates) {
    return closestCorners({ ...args, droppableContainers });
  }

  const collisions = pointerWithin({ ...args, droppableContainers });
  if (categoryDrag) return collisions;

  const channels = collisions.filter((collision) => String(collision.id).startsWith('channel:'));
  if (channels.length > 0) return channels;

  const uncategorized = collisions.find((collision) => String(collision.id) === 'group:null');
  return uncategorized ? [uncategorized] : collisions;
};

function DroppableGroup({ id, extend = false, children }: { id: string; extend?: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div ref={setNodeRef} className={cn('rounded-md transition-colors', extend && '-mb-4 pb-4', isOver && 'bg-sidebar-accent/50')}>
      {children}
    </div>
  );
}

function SortableChannel({
  channel,
  serverId,
  isActive,
  canManageChannels,
  canManageInvites,
  onInvite,
  onViewInvites,
  onRename,
}: {
  channel: ServerChannel;
  serverId: string;
  isActive: boolean;
  canManageChannels: boolean;
  canManageInvites: boolean;
  onInvite: () => void;
  onViewInvites: () => void;
  onRename: () => void;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `channel:${channel.id}` });

  return (
    <SidebarMenuItem ref={setNodeRef} style={{ transform: isDragging ? undefined : CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-0')}>
      <ContextMenu>
        <ContextMenuTrigger asChild onContextMenu={(event) => event.stopPropagation()}>
          <SidebarMenuButton asChild isActive={isActive}>
            <Link {...(canManageChannels ? listeners : {})} href={`/channels/${serverId}/${channel.id}`} draggable={false} className="py-4">
              <Hash className="h-5! w-5!" />
              <span>{channel.name}</span>
            </Link>
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={onInvite}>
            <UserPlus />
            Invite to channel
          </ContextMenuItem>
          {(canManageInvites || canManageChannels) && <ContextMenuSeparator />}
          {canManageInvites && (
            <ContextMenuItem onSelect={onViewInvites}>
              <Ticket />
              View invites
            </ContextMenuItem>
          )}
          {canManageChannels && (
            <ContextMenuItem onSelect={onRename}>
              <Pencil />
              Rename
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <SidebarMenuAction showOnHover type="button" onClick={onInvite} title="Invite to channel" aria-label="Invite to channel">
        <UserPlus />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

function SortableCategory({
  category,
  isCollapsed,
  canManageChannels,
  onToggle,
  onRename,
  onCreateChannel,
  onDelete,
  children,
}: {
  category: ServerCategory;
  isCollapsed: boolean;
  canManageChannels: boolean;
  onToggle: () => void;
  onRename: () => void;
  onCreateChannel: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `category:${category.id}` });

  return (
    <SidebarGroup ref={setNodeRef} style={{ transform: isDragging ? undefined : CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-0')}>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!canManageChannels} onContextMenu={(event) => event.stopPropagation()}>
          <SidebarGroupLabel className="pr-8">
            <button type="button" {...(canManageChannels ? listeners : {})} aria-expanded={!isCollapsed} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
              <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isCollapsed && '-rotate-90')} />
              <span className="truncate">{category.name}</span>
            </button>
          </SidebarGroupLabel>
        </ContextMenuTrigger>
        {canManageChannels && (
          <ContextMenuContent className="w-56">
            <ContextMenuItem onSelect={onRename}>
              <Pencil />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={onCreateChannel}>
              <Plus />
              Create channel
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
      {canManageChannels && (
        <SidebarGroupAction type="button" title={`Create channel in ${category.name}`} aria-label={`Create channel in ${category.name}`} onClick={onCreateChannel}>
          <Plus />
        </SidebarGroupAction>
      )}
      {children}
    </SidebarGroup>
  );
}

export function ServerSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = getServerRoute(pathname);
  const { state } = useSidebar();

  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ServerAction | null>(null);
  const [inviteChannel, setInviteChannel] = useState<ServerChannel | null>(null);
  const [channelTarget, setChannelTarget] = useState<{ categoryId: string | null } | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelRename, setChannelRename] = useState<ServerChannel | null>(null);
  const [renameName, setRenameName] = useState('');
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedServerId, setCollapsedServerId] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ type: 'channel' | 'category'; id: string } | null>(null);
  const suppressClickRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );

  const { data } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: getServers,
    staleTime: 1000 * 20,
  });

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  const server = data?.find((item) => item.id === route?.serverId);
  const serverId = server?.id;
  const isOwner = Boolean(server && user && server.ownerId === user.id);
  const canManageChannels = Boolean(server && hasPermission(server, PERMISSIONS.MANAGE_CHANNELS));
  const canManageInvites = Boolean(server && hasPermission(server, PERMISSIONS.MANAGE_INVITES));
  const canBanMembers = Boolean(server && hasPermission(server, PERMISSIONS.BAN_MEMBERS));
  const layout = server ? groupServer(server) : null;
  const categories = layout?.categories ?? [];
  const channelsById = new Map(server?.channels.map((channel) => [channel.id, channel]) ?? []);

  if (serverId && serverId !== collapsedServerId) {
    setCollapsedServerId(serverId);
    setCollapsed(readCollapsed(serverId));
  }

  const toggleCategory = (categoryId: string) => {
    if (!server) return;

    const next = { ...collapsed, [categoryId]: !collapsed[categoryId] };
    setCollapsed(next);
    window.localStorage.setItem(collapsedKey(server.id), JSON.stringify(next));
  };

  const closeChannelDialog = () => {
    setChannelTarget(null);
    setChannelName('');
    setBusy(false);
    setError(null);
  };

  const handleCreateChannel = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server || !channelTarget || busy) return;

    const name = channelName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      const channel = await createChannel(server.id, name, channelTarget.categoryId ?? undefined);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      closeChannelDialog();
      router.push(`/channels/${server.id}/${channel.id}`);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  const openChannelRename = (channel: ServerChannel) => {
    setRenameName(channel.name);
    setBusy(false);
    setError(null);
    setChannelRename(channel);
  };

  const closeChannelRename = () => {
    setChannelRename(null);
    setRenameName('');
    setBusy(false);
    setError(null);
  };

  const handleRenameChannel = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server || !channelRename || busy) return;

    const name = renameName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      await renameChannel(server.id, channelRename.id, name);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      closeChannelRename();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  const openCategoryDialog = (dialog: CategoryDialog) => {
    setCategoryName(dialog.mode === 'create' ? '' : dialog.category.name);
    setBusy(false);
    setError(null);
    setCategoryDialog(dialog);
  };

  const closeCategoryDialog = () => {
    setCategoryDialog(null);
    setCategoryName('');
    setBusy(false);
    setError(null);
  };

  const handleSaveCategory = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server || !categoryDialog || categoryDialog.mode === 'delete' || busy) return;

    const name = categoryName.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      if (categoryDialog.mode === 'create') {
        await createCategory(server.id, name);
      } else {
        await updateCategory(server.id, categoryDialog.category.id, name);
      }
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      closeCategoryDialog();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!server || categoryDialog?.mode !== 'delete' || busy) return;

    setBusy(true);
    setError(null);
    try {
      await deleteCategory(server.id, categoryDialog.category.id);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      closeCategoryDialog();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  const openChannelInvite = (channel: ServerChannel) => {
    setInviteChannel(channel);
    setAction('invite');
  };

  const openChannelInvites = (channel: ServerChannel) => {
    setInviteChannel(channel);
    setAction('invites');
  };

  const handleLayoutDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true;
    const id = String(event.active.id);
    setActiveDrag({ type: id.startsWith('category:') ? 'category' : 'channel', id: id.slice(id.indexOf(':') + 1) });
  };

  const handleLayoutDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);

    if (!server) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const current = groupServer(server);
    const movingCategory = activeId.startsWith('category:');
    const nextCategories = movingCategory ? moveCategory(current.categories, activeId, overId) : current.categories;
    const nextGroups = movingCategory ? orderGroups(current.groups, nextCategories) : moveChannel(current.groups, activeId, overId);

    const categoryPositions = new Map(nextCategories.map((category, index) => [category.id, index]));
    const placements = new Map(nextGroups.flatMap((group) => group.channelIds.map((id, position) => [id, { categoryId: group.categoryId, position }] as const)));
    const patched = {
      categories: server.categories.map((category) => ({ ...category, position: categoryPositions.get(category.id) ?? category.position })),
      channels: server.channels.map((channel) => ({ ...channel, ...(placements.get(channel.id) ?? {}) })),
    };

    const previousServers = queryClient.getQueryData<Server[]>(['servers']);
    const previousDetail = queryClient.getQueryData<ServerDetail>(['server', server.id]);

    queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((entry) => (entry.id === server.id ? { ...entry, ...patched } : entry)));
    queryClient.setQueryData<ServerDetail>(['server', server.id], (detail) => (detail ? { ...detail, ...patched } : detail));

    updateServerLayout(server.id, toLayoutPayload(nextGroups)).catch((caught) => {
      if (previousServers) queryClient.setQueryData(['servers'], previousServers);
      if (previousDetail) queryClient.setQueryData(['server', server.id], previousDetail);
      toast.error(apiErrorMessage(caught));
    });
  };

  const handleLayoutDragCancel = () => {
    setActiveDrag(null);
  };

  const activeChannel = activeDrag?.type === 'channel' ? channelsById.get(activeDrag.id) : undefined;
  const activeCategory = activeDrag?.type === 'category' ? categories.find((category) => category.id === activeDrag.id) : undefined;
  const uncategorized = layout?.groups.find((group) => group.categoryId === null)?.channelIds ?? [];

  return (
    <Sidebar style={state === 'expanded' ? { left: SERVER_RAIL_WIDTH } : undefined}>
      <SidebarHeader>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuOpen(true);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md p-2 text-left font-semibold hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <span className="truncate">{server?.name ?? 'Server'}</span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem disabled={!server} onSelect={() => setAction('members')}>
              <Users />
              Members
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!server}
              onSelect={() => {
                setInviteChannel(null);
                setAction('invite');
              }}
            >
              <UserPlus />
              Invite people
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {canManageInvites && (
              <DropdownMenuItem
                onSelect={() => {
                  setInviteChannel(null);
                  setAction('invites');
                }}
              >
                <Ticket />
                Active invites
              </DropdownMenuItem>
            )}
            {canBanMembers && (
              <DropdownMenuItem onSelect={() => setAction('bans')}>
                <Ban />
                Banned users
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!server} onSelect={() => server && router.push(`/channels/${server.id}/settings`)}>
              <Settings />
              Server settings
            </DropdownMenuItem>
            {user && !isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setAction('leave')}>
                  <LogOut />
                  Leave server
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!canManageChannels}>
          <SidebarContent
            onPointerDownCapture={() => {
              suppressClickRef.current = false;
            }}
            onKeyDownCapture={() => {
              if (!activeDrag) suppressClickRef.current = false;
            }}
            onClickCapture={(event) => {
              if (!suppressClickRef.current) return;
              suppressClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {server && layout && (
              <DndContext
                id="server-layout"
                sensors={sensors}
                collisionDetection={layoutCollisionDetection}
                onDragStart={handleLayoutDragStart}
                onDragEnd={handleLayoutDragEnd}
                onDragCancel={handleLayoutDragCancel}
              >
                <SortableContext items={layout.categories.map((category) => `category:${category.id}`)} strategy={verticalListSortingStrategy}>
                  <DroppableGroup id="group:null" extend>
                    <SidebarGroup className={cn(uncategorized.length === 0 && 'min-h-8')}>
                      <SidebarGroupContent>
                        <SortableContext items={uncategorized.map((id) => `channel:${id}`)} strategy={verticalListSortingStrategy}>
                          <SidebarMenu>
                            {uncategorized
                              .map((id) => channelsById.get(id))
                              .filter((channel): channel is ServerChannel => Boolean(channel))
                              .map((channel) => (
                                <SortableChannel
                                  key={channel.id}
                                  channel={channel}
                                  serverId={server.id}
                                  isActive={route?.channelId === channel.id}
                                  canManageChannels={canManageChannels}
                                  canManageInvites={canManageInvites}
                                  onInvite={() => openChannelInvite(channel)}
                                  onViewInvites={() => openChannelInvites(channel)}
                                  onRename={() => openChannelRename(channel)}
                                />
                              ))}
                          </SidebarMenu>
                        </SortableContext>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  </DroppableGroup>

                  {layout.categories.map((category) => {
                    const group = layout.groups.find((entry) => entry.categoryId === category.id);
                    const channelIds = group?.channelIds ?? [];
                    const isCollapsed = Boolean(collapsed[category.id]);

                    return (
                      <DroppableGroup key={category.id} id={`group:${category.id}`}>
                        <SortableCategory
                          category={category}
                          isCollapsed={isCollapsed}
                          canManageChannels={canManageChannels}
                          onToggle={() => toggleCategory(category.id)}
                          onRename={() => openCategoryDialog({ mode: 'rename', category })}
                          onCreateChannel={() => setChannelTarget({ categoryId: category.id })}
                          onDelete={() => openCategoryDialog({ mode: 'delete', category })}
                        >
                          {!isCollapsed && (
                            <SidebarGroupContent>
                              <SortableContext items={channelIds.map((id) => `channel:${id}`)} strategy={verticalListSortingStrategy}>
                                <SidebarMenu>
                                  {channelIds
                                    .map((id) => channelsById.get(id))
                                    .filter((channel): channel is ServerChannel => Boolean(channel))
                                    .map((channel) => (
                                      <SortableChannel
                                        key={channel.id}
                                        channel={channel}
                                        serverId={server.id}
                                        isActive={route?.channelId === channel.id}
                                        canManageChannels={canManageChannels}
                                        canManageInvites={canManageInvites}
                                        onInvite={() => openChannelInvite(channel)}
                                        onViewInvites={() => openChannelInvites(channel)}
                                        onRename={() => openChannelRename(channel)}
                                      />
                                    ))}
                                </SidebarMenu>
                              </SortableContext>
                            </SidebarGroupContent>
                          )}
                        </SortableCategory>
                      </DroppableGroup>
                    );
                  })}
                </SortableContext>
                {activeDrag &&
                  createPortal(
                    <DragOverlay dropAnimation={null}>
                      {activeChannel && (
                        <div className="flex w-60 items-center gap-2 rounded-md bg-sidebar-accent px-2 py-2 text-sm text-sidebar-accent-foreground shadow-lg">
                          <Hash className="h-4 w-4" />
                          <span className="truncate">{activeChannel.name}</span>
                        </div>
                      )}
                      {activeCategory && (
                        <div className="flex w-60 items-center gap-1 rounded-md bg-sidebar-accent px-2 py-1.5 text-xs font-medium text-sidebar-accent-foreground shadow-lg">
                          <ChevronDown className="h-4 w-4" />
                          <span className="truncate">{activeCategory.name}</span>
                        </div>
                      )}
                    </DragOverlay>,
                    document.body,
                  )}
              </DndContext>
            )}
          </SidebarContent>
        </ContextMenuTrigger>
        {canManageChannels && (
          <ContextMenuContent className="w-56">
            <ContextMenuItem onSelect={() => setChannelTarget({ categoryId: null })}>
              <Plus />
              Create channel
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => openCategoryDialog({ mode: 'create' })}>
              <FolderPlus />
              Create category
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <UserPanel />

      <Dialog open={channelTarget !== null} onOpenChange={(open) => !open && closeChannelDialog()}>
        <DialogContent>
          <form onSubmit={handleCreateChannel} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Create a channel</DialogTitle>
              <DialogDescription>Channels are where members chat.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-name">Channel name</Label>
              <Input id="channel-name" value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="new-channel" maxLength={32} disabled={busy} />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeChannelDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={!channelName.trim() || busy}>
                Create channel
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={channelRename !== null} onOpenChange={(open) => !open && closeChannelRename()}>
        <DialogContent>
          <form onSubmit={handleRenameChannel} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Rename channel</DialogTitle>
              <DialogDescription>Pick a new name for this channel.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="channel-rename">Channel name</Label>
              <Input id="channel-rename" value={renameName} onChange={(event) => setRenameName(event.target.value)} placeholder="new-channel" maxLength={32} disabled={busy} />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeChannelRename}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renameName.trim() || busy}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialog?.mode === 'create' || categoryDialog?.mode === 'rename'} onOpenChange={(open) => !open && closeCategoryDialog()}>
        <DialogContent>
          <form onSubmit={handleSaveCategory} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{categoryDialog?.mode === 'rename' ? 'Rename category' : 'Create a category'}</DialogTitle>
              <DialogDescription>Categories group channels in the sidebar.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category-name">Category name</Label>
              <Input id="category-name" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Projects" maxLength={50} disabled={busy} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCategoryDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={!categoryName.trim() || busy}>
                {categoryDialog?.mode === 'rename' ? 'Save' : 'Create category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={categoryDialog?.mode === 'delete'} onOpenChange={(open) => !open && closeCategoryDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete <b>{categoryDialog?.mode === 'delete' ? categoryDialog.category.name : ''}</b>?
            </DialogTitle>
            <DialogDescription>Channels will move to Uncategorized.</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCategoryDialog}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDeleteCategory} disabled={busy}>
              Delete category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServerActionDialogs
        server={server ?? null}
        action={action}
        inviteChannel={inviteChannel}
        onClose={() => {
          setAction(null);
          setInviteChannel(null);
        }}
      />
    </Sidebar>
  );
}
