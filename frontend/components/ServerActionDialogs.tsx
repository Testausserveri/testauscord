'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvite, getInvites, leaveServer, revokeInvite } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { Server, ServerAction, ServerInvite } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

type Props = {
  server: Server | null;
  action: ServerAction | null;
  inviteChannel?: { id: string; name: string } | null;
  onClose: () => void;
};

export function ServerActionDialogs({ server, action, inviteChannel = null, onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState<{ channelId: string | null; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverId = server?.id;
  const inviteChannelId = inviteChannel?.id ?? null;
  const inviteCode = invite && invite.channelId === inviteChannelId ? invite.code : null;

  const canManageInvites = Boolean(server && hasPermission(server, PERMISSIONS.MANAGE_INVITES));

  const { data: invites, isPending: invitesPending } = useQuery<ServerInvite[]>({
    queryKey: ['server-invites', serverId],
    queryFn: () => getInvites(serverId!),
    enabled: action === 'invites' && Boolean(serverId) && canManageInvites,
    staleTime: 1000 * 20,
  });

  const visibleInvites = inviteChannel ? invites?.filter((entry) => entry.channel?.id === inviteChannel.id) : invites;

  const close = () => {
    setInvite(null);
    setCopied(false);
    setBusy(false);
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (action !== 'invite' || !serverId) return;

    let active = true;
    createInvite(serverId, inviteChannelId ?? undefined)
      .then((result) => {
        if (!active) return;
        setInvite({ channelId: inviteChannelId, code: result.code });
        setCopied(false);
        setError(null);
        void queryClient.invalidateQueries({ queryKey: ['server-invites', serverId] });
      })
      .catch((caught) => {
        if (active) setError(apiErrorMessage(caught));
      });

    return () => {
      active = false;
    };
  }, [action, serverId, inviteChannelId, queryClient]);

  const handleCopyInvite = async () => {
    if (!inviteCode) return;
    await navigator.clipboard.writeText(inviteCode);
    setCopied(true);
  };

  const handleRevoke = async (code: string) => {
    if (!serverId || busy) return;

    setBusy(true);
    setError(null);
    try {
      await revokeInvite(serverId, code);
      await queryClient.invalidateQueries({ queryKey: ['server-invites', serverId] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    if (!server || busy) return;

    setBusy(true);
    setError(null);
    try {
      await leaveServer(server.id);
      await queryClient.invalidateQueries({ queryKey: ['servers'] });
      close();
      router.push('/channels/@me');
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={action === 'invite'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite people</DialogTitle>
            <DialogDescription>
              {inviteChannel ? (
                <>
                  Anyone with this code joins <b>#{inviteChannel.name}</b>.
                </>
              ) : (
                <>
                  Anyone with this code joins <b>{server?.name}</b>.
                </>
              )}{' '}
              Codes expire after 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteCode ?? ''} placeholder={error ? '' : 'Creating invite...'} onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="secondary" onClick={handleCopyInvite} disabled={!inviteCode}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {canManageInvites && <p className="text-xs text-muted-foreground">{inviteChannel ? 'Manage existing codes from the channel menu.' : 'Manage existing codes from Server settings.'}</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'invites'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {inviteChannel ? (
                <>
                  Invites for <b>#{inviteChannel.name}</b>
                </>
              ) : (
                'Active invites'
              )}
            </DialogTitle>
            <DialogDescription>
              {inviteChannel ? (
                'Codes that still grant access to this channel.'
              ) : (
                <>
                  Codes that still grant access to <b>{server?.name}</b>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {!canManageInvites ? (
            <p className="text-sm text-muted-foreground">You do not have permission to manage invites.</p>
          ) : invitesPending ? (
            <p className="text-sm text-muted-foreground">Loading invites...</p>
          ) : visibleInvites && visibleInvites.length > 0 ? (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {visibleInvites.map((entry) => (
                <div key={entry.code} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{entry.code}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.channel ? `#${entry.channel.name}` : 'Server'}, {entry.createdBy.displayName ?? entry.createdBy.username}, expires {new Date(entry.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRevoke(entry.code)} disabled={busy}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active invites{inviteChannel ? ' for this channel' : ''}.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'leave'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Leave <b>{server?.name}</b>?
            </DialogTitle>
            <DialogDescription>You will need an invite to join again.</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleLeave} disabled={busy}>
              Leave server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
