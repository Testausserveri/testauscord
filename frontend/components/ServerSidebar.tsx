'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Hash, LogOut, Plus, Ticket, UserPlus, Users } from 'lucide-react';
import { createChannel, getServers, getUser } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { CurrentUser, Server, ServerAction } from '@/types/types';
import { getServerRoute } from '@/lib/serverRoutes';
import { SERVER_RAIL_WIDTH } from '@/lib/layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServerActionDialogs } from '@/components/ServerActionDialogs';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

export function ServerSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const route = getServerRoute(pathname);
  const { state } = useSidebar();

  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ServerAction | null>(null);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [channelName, setChannelName] = useState('');
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
  const isOwner = Boolean(server && user && server.ownerId === user.id);

  const closeChannelDialog = () => {
    setChannelDialogOpen(false);
    setChannelName('');
    setBusy(false);
    setError(null);
  };

  const handleCreateChannel = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server || busy) return;

    const name = channelName.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      const channel = await createChannel(server.id, name);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      await queryClient.invalidateQueries({ queryKey: ['server', server.id] });
      closeChannelDialog();
      router.push(`/channels/${server.id}/${channel.id}`);
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

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
                <DropdownMenuItem onSelect={() => setChannelDialogOpen(true)}>
                  <Plus />
                  Create channel
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

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Channels</SidebarGroupLabel>
          {isOwner && (
            <SidebarGroupAction type="button" title="Create channel" aria-label="Create channel" onClick={() => setChannelDialogOpen(true)}>
              <Plus />
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {server?.channels.map((channel) => (
                <SidebarMenuItem key={channel.id}>
                  <SidebarMenuButton asChild isActive={route?.channelId === channel.id}>
                    <Link href={`/channels/${server.id}/${channel.id}`} className="py-4">
                      <Hash className="!h-5 !w-5" />
                      <span>{channel.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <Dialog open={channelDialogOpen} onOpenChange={(open) => !open && closeChannelDialog()}>
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

      <ServerActionDialogs server={server ?? null} action={action} onClose={() => setAction(null)} />
    </Sidebar>
  );
}
