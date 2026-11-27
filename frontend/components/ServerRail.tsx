'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, LogOut, MessageCircle, Plus, Settings, Ticket, UserPlus, Users } from 'lucide-react';
import { createServer, getPendingRequests, getServers, getUser, joinServer, logout, reorderServers } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { toast } from 'sonner';
import { CurrentUser, IncomingFriendRequest, Server, ServerAction } from '@/types/types';
import { firstChannel, getServerRoute } from '@/lib/serverRoutes';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { logoutToLogin } from '@/lib/logout';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { ServerActionDialogs } from './ServerActionDialogs';
import { ServerIcon } from './ServerIcon';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

function SortableServer({ server, isActive, user, onAction }: { server: Server; isActive: boolean; user: CurrentUser | undefined; onAction: (action: ServerAction) => void }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: server.id });
  const channel = firstChannel(server);
  const href = channel ? `/channels/${server.id}/${channel.id}` : '/channels/@me';
  const canManageInvites = hasPermission(server, PERMISSIONS.MANAGE_INVITES);
  const canBanMembers = hasPermission(server, PERMISSIONS.BAN_MEMBERS);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex h-12 w-12 shrink-0 touch-none items-center justify-center ${isDragging ? 'opacity-40' : ''}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link
            {...listeners}
            href={href}
            draggable={false}
            title={server.name}
            className={`flex h-12 w-12 shrink-0 cursor-grab items-center justify-center overflow-hidden rounded-2xl bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80 active:cursor-grabbing ${isActive ? 'rounded-xl ring-2 ring-sidebar-ring' : ''}`}
          >
            <ServerIcon server={server} alwaysAnimate={isActive} />
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={() => onAction('members')}>
            <Users />
            Members
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onAction('invite')}>
            <UserPlus />
            Invite people
          </ContextMenuItem>
          <ContextMenuSeparator />
          {canManageInvites && (
            <ContextMenuItem onSelect={() => onAction('invites')}>
              <Ticket />
              Active invites
            </ContextMenuItem>
          )}
          {canBanMembers && (
            <ContextMenuItem onSelect={() => onAction('bans')}>
              <Ban />
              Banned users
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => onAction('settings')}>
            <Settings />
            Server settings
          </ContextMenuItem>
          {user && user.id !== server.ownerId && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onAction('leave')}>
                <LogOut />
                Leave server
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function ServerRail() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = getServerRoute(pathname);
  const isSettingsRoute = pathname === '/channels/me/settings' || pathname === '/channels/@me/settings';

  const [sheetOpen, setSheetOpen] = useState(false);
  const [serverName, setServerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionServer, setActionServer] = useState<Server | null>(null);
  const [action, setAction] = useState<ServerAction | null>(null);
  const [activeServer, setActiveServer] = useState<Server | null>(null);

  const { data: servers } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: getServers,
    staleTime: 1000 * 20,
  });

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  const { data: pending } = useQuery<IncomingFriendRequest[]>({
    queryKey: ['friend-requests-pending'],
    queryFn: getPendingRequests,
    staleTime: 1000 * 20,
  });

  const pendingCount = pending?.length ?? 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveServer(servers?.find((server) => server.id === event.active.id) ?? null);
  };

  const handleDragCancel = () => setActiveServer(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveServer(null);
    const { active, over } = event;
    if (!servers || !over || active.id === over.id) return;

    const oldIndex = servers.findIndex((server) => server.id === active.id);
    const newIndex = servers.findIndex((server) => server.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(servers, oldIndex, newIndex);
    queryClient.setQueryData(['servers'], next);
    reorderServers(next.map((server) => server.id)).catch((caught) => {
      queryClient.setQueryData(['servers'], servers);
      toast.error(apiErrorMessage(caught));
    });
  };

  const enterServer = (server: Server & { inviteChannelId?: string | null }) => {
    queryClient.invalidateQueries({ queryKey: ['servers'] });
    queryClient.invalidateQueries({ queryKey: ['server', server.id] });
    setSheetOpen(false);
    setServerName('');
    setInviteCode('');
    setError(null);

    const inviteChannel = server.inviteChannelId ? server.channels.find((entry) => entry.id === server.inviteChannelId) : undefined;
    const channel = inviteChannel ?? firstChannel(server);
    router.push(channel ? `/channels/${server.id}/${channel.id}` : '/channels/@me');
  };

  const handleCreate = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = serverName.trim();
    if (!name || busy) return;

    setBusy(true);
    setError(null);
    try {
      enterServer(await createServer(name));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = inviteCode.trim();
    if (!code || busy) return;

    setBusy(true);
    setError(null);
    try {
      enterServer(await joinServer(code));
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    const result = await logout();

    if (!result.success) {
      toast.error(String(result.msg ?? 'Could not log out'));
      setLoggingOut(false);
      return;
    }

    logoutToLogin('logout');
  };

  return (
    <nav style={{ width: SERVER_RAIL_WIDTH }} className="relative z-20 flex shrink-0 flex-col items-center gap-2 overflow-hidden border-r border-sidebar-border bg-sidebar py-3">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto p-1 scrollbar-none [&::-webkit-scrollbar]:hidden">
        <Link
          href="/channels/@me"
          title="Direct Messages"
          aria-label="Direct Messages"
          className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80 ${route || isSettingsRoute ? '' : 'rounded-xl ring-2 ring-sidebar-ring'}`}
        >
          <MessageCircle className="h-6 w-6" />
          {pendingCount > 0 && (
            <span
              aria-label={`${pendingCount} pending friend requests`}
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white"
            >
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </Link>

        <div className="h-px w-8 shrink-0 bg-sidebar-border" />

        <DndContext id="server-rail" sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
          <SortableContext items={servers?.map((server) => server.id) ?? []} strategy={verticalListSortingStrategy}>
            {servers?.map((server: Server) => (
              <SortableServer
                key={server.id}
                server={server}
                isActive={route?.serverId === server.id}
                user={user}
                onAction={(nextAction) => {
                  if (nextAction === 'settings') {
                    router.push(`/channels/${server.id}/settings`);
                    return;
                  }

                  setActionServer(server);
                  setAction(nextAction);
                }}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeServer && (
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground shadow-lg">
                <ServerIcon server={activeServer} static />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              title="Add a server"
              aria-label="Add a server"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80"
            >
              <Plus className="h-6 w-6" />
            </button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Add a server</SheetTitle>
              <SheetDescription>Create your own space or join one with an invite code.</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-4">
              <form onSubmit={handleCreate} className="flex flex-col gap-2">
                <Label htmlFor="server-name">Create a server</Label>
                <Input id="server-name" value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="My server" maxLength={100} disabled={busy} />
                <Button type="submit" disabled={!serverName.trim() || busy}>
                  Create server
                </Button>
              </form>

              <div className="flex items-center gap-2">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground">OR</span>
                <Separator className="flex-1" />
              </div>

              <form onSubmit={handleJoin} className="flex flex-col gap-2">
                <Label htmlFor="invite-code">Join with an invite code</Label>
                <Input id="invite-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Invite code" maxLength={64} disabled={busy} />
                <Button type="submit" variant="secondary" disabled={!inviteCode.trim() || busy}>
                  Join server
                </Button>
              </form>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <button
        type="button"
        onClick={() => {
          if (!isSettingsRoute) router.push('/channels/@me/settings');
        }}
        title="Account settings"
        aria-label="Account settings"
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80 ${isSettingsRoute ? 'rounded-xl ring-2 ring-sidebar-ring' : ''}`}
      >
        <Settings className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={() => setLogoutOpen(true)}
        title="Log out"
        aria-label="Log out"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-destructive text-white transition-all hover:rounded-xl hover:bg-destructive/90"
      >
        <LogOut className="h-5 w-5" />
      </button>

      <Dialog open={logoutOpen} onOpenChange={(open) => !loggingOut && setLogoutOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>You will need to log in again to access your messages.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLogoutOpen(false)} disabled={loggingOut}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleLogout} disabled={loggingOut}>
              Log out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServerActionDialogs server={actionServer} action={action} onClose={() => setAction(null)} />
    </nav>
  );
}
