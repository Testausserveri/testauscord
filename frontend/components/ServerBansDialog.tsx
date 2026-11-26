'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBans, unbanMember } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { Server, ServerBan } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { UserAvatar } from './UserAvatar';
import { useProfilePopover } from './ProfilePopoverProvider';

type Props = {
  server: Server | null;
  onClose: () => void;
};

export function ServerBansDialog({ server, onClose }: Props) {
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: bans,
    isPending,
    error: loadError,
  } = useQuery<ServerBan[]>({
    queryKey: ['server-bans', server?.id],
    queryFn: () => getBans(server!.id),
    enabled: Boolean(server?.id),
    staleTime: 1000 * 20,
  });

  const handleUnban = async (userId: string) => {
    if (!server || busyId) return;

    setBusyId(userId);
    setError(null);
    try {
      await unbanMember(server.id, userId);
      await queryClient.invalidateQueries({ queryKey: ['server-bans', server.id] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Banned users</DialogTitle>
          <DialogDescription>People who cannot rejoin {server?.name} until you unban them.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading bans...</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{apiErrorMessage(loadError)}</p>
        ) : bans && bans.length > 0 ? (
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {bans.map((ban) => (
              <div key={ban.id} data-avatar-hover className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                <button type="button" onClick={(event) => openProfile(ban.id, event.currentTarget)} title="View profile" className="group flex min-w-0 items-center gap-2 rounded-sm text-left">
                  <UserAvatar user={ban} className="h-8 w-8 shrink-0" />
                  <span className="min-w-0">
                    <p className="truncate text-sm font-medium group-hover:underline">{ban.displayName ?? ban.username}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ban.reason ?? 'No reason'}, {new Date(ban.createdAt).toLocaleDateString()}, by {ban.bannedBy.displayName ?? ban.bannedBy.username}
                    </p>
                  </span>
                </button>
                <Button type="button" variant="secondary" size="sm" onClick={() => handleUnban(ban.id)} disabled={busyId !== null}>
                  {busyId === ban.id ? 'Unbanning...' : 'Unban'}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No banned users.</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
