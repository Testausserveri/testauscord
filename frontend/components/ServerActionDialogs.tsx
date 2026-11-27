'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { banMember, createInvite, getInvites, getServer, getUser, leaveServer, removeMember, revokeInvite } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { CurrentUser, Server, ServerAction, ServerDetail, ServerInvite, UserRef } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useProfilePopover } from './ProfilePopoverProvider';
import { ServerBansDialog } from './ServerBansDialog';
import { ServerSettingsDialog } from './ServerSettingsDialog';

type Props = {
  server: Server | null;
  action: ServerAction | null;
  inviteChannel?: { id: string; name: string } | null;
  onClose: () => void;
};

export function ServerActionDialogs({ server, action, inviteChannel = null, onClose }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const [invite, setInvite] = useState<{ channelId: string | null; code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moderation, setModeration] = useState<{ kind: 'kick' | 'ban'; member: UserRef } | null>(null);
  const [banReason, setBanReason] = useState('');

  const serverId = server?.id;
  const inviteChannelId = inviteChannel?.id ?? null;
  const inviteCode = invite && invite.channelId === inviteChannelId ? invite.code : null;

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

  const visibleInvites = inviteChannel ? invites?.filter((entry) => entry.channel?.id === inviteChannel.id) : invites;

  const close = () => {
    setInvite(null);
    setCopied(false);
    setBusy(false);
    setError(null);
    setModeration(null);
    setBanReason('');
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

  const openModeration = (kind: 'kick' | 'ban', member: UserRef) => {
    setError(null);
    setBanReason('');
    setModeration({ kind, member });
  };

  const closeModeration = () => {
    setModeration(null);
    setBanReason('');
    setBusy(false);
    setError(null);
  };

  const handleModeration = async () => {
    if (!serverId || !moderation || busy) return;

    setBusy(true);
    setError(null);
    try {
      if (moderation.kind === 'kick') {
        await removeMember(serverId, moderation.member.id);
      } else {
        await banMember(serverId, moderation.member.id, banReason.trim() || undefined);
      }
      await queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      await queryClient.invalidateQueries({ queryKey: ['server-bans', serverId] });
      closeModeration();
    } catch (caught) {
      setError(apiErrorMessage(caught));
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
          {isOwner && (
            <p className="text-xs text-muted-foreground">{inviteChannel ? 'Manage existing codes from the channel menu.' : 'Manage existing codes from Active invites.'}</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={action === 'invites'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{inviteChannel ? <>Invites for <b>#{inviteChannel.name}</b></> : 'Active invites'}</DialogTitle>
            <DialogDescription>
              {inviteChannel ? 'Codes that still grant access to this channel.' : <>Codes that still grant access to <b>{server?.name}</b>.</>}
            </DialogDescription>
          </DialogHeader>
          {!isOwner ? (
            <p className="text-sm text-muted-foreground">Only the server owner can manage invites.</p>
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

      <Dialog open={action === 'members'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Members of <b>{server?.name}</b>
            </DialogTitle>
            <DialogDescription>{isOwner ? 'Kick removes access until a new invite. Ban blocks the user until you unban them.' : 'People with access to this server.'}</DialogDescription>
          </DialogHeader>
          {detailPending ? (
            <p className="text-sm text-muted-foreground">Loading members...</p>
          ) : detail ? (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {detail.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                  <button type="button" onClick={(event) => openProfile(member.id, event.currentTarget)} title="View profile" className="group min-w-0 rounded-sm text-left">
                    <p className="truncate text-sm font-medium group-hover:underline">{member.displayName ?? member.username}</p>
                    <p className="text-xs text-muted-foreground">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>
                  </button>
                  {member.id === server?.ownerId ? (
                    <span className="text-xs text-muted-foreground">Owner</span>
                  ) : isOwner ? (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="secondary" size="sm" onClick={() => openModeration('kick', member)} disabled={busy}>
                        Kick
                      </Button>
                      <Button type="button" variant="destructive" size="sm" onClick={() => openModeration('ban', member)} disabled={busy}>
                        Ban
                      </Button>
                    </div>
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

      <Dialog open={moderation !== null} onOpenChange={(open) => !open && closeModeration()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moderation?.kind === 'ban' ? 'Ban' : 'Kick'} <b>{moderation?.member.displayName ?? moderation?.member.username}</b>?
            </DialogTitle>
            <DialogDescription>
              {moderation?.kind === 'ban' ? `They lose access to ${server?.name} and cannot rejoin until you unban them.` : `They lose access to ${server?.name} until they join with a new invite.`}
            </DialogDescription>
          </DialogHeader>
          {moderation?.kind === 'ban' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ban-reason">Reason (optional)</Label>
              <Input id="ban-reason" value={banReason} onChange={(event) => setBanReason(event.target.value)} maxLength={200} placeholder="Why they were banned" disabled={busy} />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeModeration}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleModeration} disabled={busy}>
              {moderation?.kind === 'ban' ? 'Ban' : 'Kick'}
            </Button>
          </DialogFooter>
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

      {action === 'bans' && <ServerBansDialog server={server} onClose={close} />}
      {action === 'settings' && <ServerSettingsDialog server={server} onClose={close} />}
    </>
  );
}
