'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronDown, FolderPlus, Hash, LogOut, MoreHorizontal, Pencil, Plus, Settings, Ticket, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { createCategory, createChannel, deleteCategory, getServers, getUser, updateCategory, updateChannelCategory } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { cn } from '@/lib/utils';
import { CurrentUser, Server, ServerAction, ServerCategory, ServerChannel } from '@/types/types';
import { getServerRoute } from '@/lib/serverRoutes';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

export function ServerSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = getServerRoute(pathname);
  const { state } = useSidebar();

  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ServerAction | null>(null);
  const [channelTarget, setChannelTarget] = useState<{ categoryId: string | null } | null>(null);
  const [channelName, setChannelName] = useState('');
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedServerId, setCollapsedServerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const categories = server?.categories ?? [];

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

  const handleMoveChannel = async (channelId: string, categoryId: string | null) => {
    if (!server) return;

    try {
      await updateChannelCategory(server.id, channelId, categoryId);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
    }
  };

  const renderChannel = (channel: ServerChannel) => (
    <SidebarMenuItem key={channel.id}>
      <SidebarMenuButton asChild isActive={route?.channelId === channel.id}>
        <Link href={`/channels/${server?.id}/${channel.id}`} className="py-4">
          <Hash className="!h-5 !w-5" />
          <span>{channel.name}</span>
        </Link>
      </SidebarMenuButton>
      {isOwner && categories.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover title="Channel options" aria-label="Channel options">
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <DropdownMenuItem disabled={!channel.categoryId} onSelect={() => handleMoveChannel(channel.id, null)}>
              Uncategorized
            </DropdownMenuItem>
            {categories.map((category) => (
              <DropdownMenuItem key={category.id} disabled={channel.categoryId === category.id} onSelect={() => handleMoveChannel(channel.id, category.id)}>
                {category.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  );

  const uncategorized = server?.channels.filter((channel) => !channel.categoryId) ?? [];

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
            <DropdownMenuItem disabled={!server} onSelect={() => setAction('invite')}>
              <UserPlus />
              Invite people
            </DropdownMenuItem>
            {isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setAction('invites')}>
                  <Ticket />
                  Active invites
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAction('bans')}>
                  <Ban />
                  Banned users
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAction('settings')}>
                  <Settings />
                  Server settings
                </DropdownMenuItem>
              </>
            )}
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
        <ContextMenuTrigger asChild disabled={!isOwner}>
          <SidebarContent>
            {server && (
              <>
                {uncategorized.length > 0 && (
                  <SidebarGroup>
                    <SidebarGroupContent>
                      <SidebarMenu>{uncategorized.map(renderChannel)}</SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )}
                {categories.map((category) => {
                  const channels = server.channels.filter((channel) => channel.categoryId === category.id);
                  const isCollapsed = Boolean(collapsed[category.id]);

                  return (
                    <SidebarGroup key={category.id}>
                      <ContextMenu>
                        <ContextMenuTrigger asChild disabled={!isOwner} onContextMenu={(event) => event.stopPropagation()}>
                          <SidebarGroupLabel asChild>
                            <button type="button" aria-expanded={!isCollapsed} onClick={() => toggleCategory(category.id)} className="w-full gap-1 pr-8">
                              <ChevronDown className={cn('transition-transform', isCollapsed && '-rotate-90')} />
                              <span className="truncate">{category.name}</span>
                            </button>
                          </SidebarGroupLabel>
                        </ContextMenuTrigger>
                        {isOwner && (
                          <ContextMenuContent className="w-56">
                            <ContextMenuItem onSelect={() => openCategoryDialog({ mode: 'rename', category })}>
                              <Pencil />
                              Rename
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => setChannelTarget({ categoryId: category.id })}>
                              <Plus />
                              Create channel
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem variant="destructive" onSelect={() => openCategoryDialog({ mode: 'delete', category })}>
                              <Trash2 />
                              Delete
                            </ContextMenuItem>
                          </ContextMenuContent>
                        )}
                      </ContextMenu>
                      {isOwner && (
                        <SidebarGroupAction
                          type="button"
                          title={`Create channel in ${category.name}`}
                          aria-label={`Create channel in ${category.name}`}
                          onClick={() => setChannelTarget({ categoryId: category.id })}
                        >
                          <Plus />
                        </SidebarGroupAction>
                      )}
                      {!isCollapsed && (
                        <SidebarGroupContent>
                          <SidebarMenu>{channels.map(renderChannel)}</SidebarMenu>
                        </SidebarGroupContent>
                      )}
                    </SidebarGroup>
                  );
                })}
              </>
            )}
          </SidebarContent>
        </ContextMenuTrigger>
        {isOwner && (
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

      <ServerActionDialogs server={server ?? null} action={action} onClose={() => setAction(null)} />
    </Sidebar>
  );
}
