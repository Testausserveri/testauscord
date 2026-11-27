'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getBans, unbanMember } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { Server, ServerBan } from '@/types/types';
import { UserAvatar } from '@/components/UserAvatar';
import { Button } from '@/components/ui/button';

export function BansTab({ server }: { server: Server }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: bans,
    isPending,
    error: loadError,
  } = useQuery<ServerBan[]>({
    queryKey: ['server-bans', server.id],
    queryFn: () => getBans(server.id),
    staleTime: 1000 * 20,
  });

  const handleUnban = async (userId: string) => {
    if (busyId) return;

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
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        People who cannot rejoin <b>{server.name}</b> until you unban them.
      </p>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading bans...</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{apiErrorMessage(loadError)}</p>
      ) : bans && bans.length > 0 ? (
        <div className="flex flex-col gap-1">
          {bans.map((ban) => (
            <div key={ban.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={ban} className="h-8 w-8 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ban.displayName ?? ban.username}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {ban.reason ?? 'No reason'} · {new Date(ban.createdAt).toLocaleDateString()} · by {ban.bannedBy.displayName ?? ban.bannedBy.username}
                  </p>
                </div>
              </div>
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
    </div>
  );
}
