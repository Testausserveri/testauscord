'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvite, getInvites, revokeInvite } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { Server, ServerInvite } from '@/types/types';
import { Button } from '@/components/ui/button';

export function InvitesTab({ server }: { server: Server }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: invites,
    isPending,
    isError,
  } = useQuery<ServerInvite[]>({
    queryKey: ['server-invites', server.id],
    queryFn: () => getInvites(server.id),
    staleTime: 1000 * 20,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['server-invites', server.id] });

  const handleCreate = async () => {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await createInvite(server.id);
      await refresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (code: string) => {
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      await revokeInvite(server.id, code);
      await refresh();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Codes that still grant access to {server.name}.</p>
        <Button type="button" onClick={handleCreate} disabled={busy}>
          Create invite
        </Button>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading invites...</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Invites unavailable.</p>
      ) : invites && invites.length > 0 ? (
        <div className="flex flex-col gap-1">
          {invites.map((entry) => (
            <div key={entry.code} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm">{entry.code}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.channel ? `#${entry.channel.name}` : 'Server'} · {entry.createdBy.displayName ?? entry.createdBy.username} · expires {new Date(entry.expiresAt).toLocaleDateString()}
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
    </div>
  );
}
