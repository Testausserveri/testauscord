'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvite, getInvites, getServer, getUser, leaveServer, removeMember, revokeInvite } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { CurrentUser, Server, ServerAction, ServerDetail, ServerInvite } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

type Props = {
  server: Server | null;
  action: ServerAction | null;
  onClose: () => void;
};

export function ServerActionDialogs({ server, action, onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serverId = server?.id;

  const { data: currentUser } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  const { data: detail, isPending: detailPending } = useQuery<ServerDetail>({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId!),
    enabled: action === 'members' && Boolean(serverId),
    staleTime: 1000 * 20,
  });

  const isOwner = Boolean(server && currentUser && server.ownerId === currentUser.id);

  const { data: invites, isPending: invitesPending } = useQuery<ServerInvite[]>({
    queryKey: ['server-invites', serverId],
    queryFn: () => getInvites(serverId!),
    enabled: action === 'invites' && Boolean(serverId) && isOwner,
    staleTime: 1000 * 20,
  });

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
    createInvite(serverId)
      .then((result) => {
        if (active) {
          setInvite(result.code);
          setCopied(false);
        }
      })
      .catch((caught) => {
        if (active) setError(apiErrorMessage(caught));
      });

    return () => {
      active = false;
    };
  }, [action, serverId]);

  const handleCopyInvite = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite);
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

  const handleRemoveMember = async (userId: string) => {
    if (!serverId || busy) return;

    setBusy(true);
    setError(null);
    try {
      await removeMember(serverId, userId);
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
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
              Share this code so others can join <b>{server?.name}</b>. Codes expire after 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={invite ?? ''} placeholder={error ? '' : 'Creating invite...'} onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="secondary" onClick={handleCopyInvite} disabled={!invite}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {isOwner && <p className="text-xs text-muted-foreground">Manage existing codes from Active invites.</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'invites'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Active invites</DialogTitle>
            <DialogDescription>
              Codes that still grant access to <b>{server?.name}</b>.
            </DialogDescription>
          </DialogHeader>
          {!isOwner ? (
            <p className="text-sm text-muted-foreground">Only the server owner can manage invites.</p>
          ) : invitesPending ? (
            <p className="text-sm text-muted-foreground">Loading invites...</p>
          ) : invites && invites.length > 0 ? (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {invites.map((entry) => (
                <div key={entry.code} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{entry.code}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.createdBy.username}, expires {new Date(entry.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRevoke(entry.code)} disabled={busy}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active invites.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'members'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Members of <b>{server?.name}</b>
            </DialogTitle>
            <DialogDescription>{isOwner ? 'Remove members who should no longer have access.' : 'People with access to this server.'}</DialogDescription>
          </DialogHeader>
          {detailPending ? (
            <p className="text-sm text-muted-foreground">Loading members...</p>
          ) : detail ? (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {detail.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{member.username}</p>
                    <p className="text-xs text-muted-foreground">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>
                  </div>
                  {member.id === server?.ownerId ? (
                    <span className="text-xs text-muted-foreground">Owner</span>
                  ) : isOwner ? (
                    <Button type="button" variant="destructive" size="sm" onClick={() => handleRemoveMember(member.id)} disabled={busy}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Members unavailable.</p>
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
