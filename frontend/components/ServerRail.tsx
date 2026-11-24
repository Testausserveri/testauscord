'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MessageCircle, Plus, Settings, Ticket, UserPlus, Users } from 'lucide-react';
import { createServer, getServers, getUser, joinServer, logout } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { toast } from 'sonner';
import { CurrentUser, Server, ServerAction } from '@/types/types';
import { getServerRoute } from '@/lib/serverRoutes';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { logoutToLogin } from '@/lib/logout';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './ui/context-menu';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { AccountSettingsDialog } from './AccountSettingsDialog';
import { ServerActionDialogs } from './ServerActionDialogs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function ServerRail() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = getServerRoute(pathname);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [serverName, setServerName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionServer, setActionServer] = useState<Server | null>(null);
  const [action, setAction] = useState<ServerAction | null>(null);

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

  const enterServer = (server: Server) => {
    queryClient.invalidateQueries({ queryKey: ['servers'] });
    queryClient.invalidateQueries({ queryKey: ['server', server.id] });
    setSheetOpen(false);
    setServerName('');
    setInviteCode('');
    setError(null);

    const firstChannel = server.channels[0];
    router.push(firstChannel ? `/channels/${server.id}/${firstChannel.id}` : '/channels/@me');
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
    <nav style={{ width: SERVER_RAIL_WIDTH }} className="relative z-20 flex shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-sidebar py-3">
      <Link
        href="/channels/@me"
        title="Direct Messages"
        aria-label="Direct Messages"
        className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80 ${route ? '' : 'rounded-xl ring-2 ring-sidebar-ring'}`}
      >
        <MessageCircle className="h-6 w-6" />
      </Link>

      <div className="h-px w-8 bg-sidebar-border" />

      {servers?.map((server: Server) => {
        const firstChannel = server.channels[0];
        const href = firstChannel ? `/channels/${server.id}/${firstChannel.id}` : '/channels/@me';

        return (
          <ContextMenu key={server.id}>
            <ContextMenuTrigger asChild>
              <Link
                href={href}
                title={server.name}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80 ${route?.serverId === server.id ? 'rounded-xl ring-2 ring-sidebar-ring' : ''}`}
              >
                {initials(server.name)}
              </Link>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem
                onSelect={() => {
                  setActionServer(server);
                  setAction('members');
                }}
              >
                <Users />
                Members
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  setActionServer(server);
                  setAction('invite');
                }}
              >
                <UserPlus />
                Invite people
              </ContextMenuItem>
              {user?.id === server.ownerId && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => {
                      setActionServer(server);
                      setAction('invites');
                    }}
                  >
                    <Ticket />
                    Active invites
                  </ContextMenuItem>
                </>
              )}
              {user && user.id !== server.ownerId && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => {
                      setActionServer(server);
                      setAction('leave');
                    }}
                  >
                    <LogOut />
                    Leave server
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      })}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            title="Add a server"
            aria-label="Add a server"
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80"
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

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title="Account settings"
        aria-label="Account settings"
        className="mt-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sidebar-accent text-sidebar-accent-foreground transition-all hover:rounded-xl hover:bg-sidebar-accent/80"
      >
        <Settings className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={() => setLogoutOpen(true)}
        title="Log out"
        aria-label="Log out"
        className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive text-white transition-all hover:rounded-xl hover:bg-destructive/90"
      >
        <LogOut className="h-5 w-5" />
      </button>

      <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

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
