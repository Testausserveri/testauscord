'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { renameServer } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { Server, ServerDetail } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Props = {
  server: Server | null;
  onClose: () => void;
};

export function ServerSettingsDialog({ server, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(server?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const unchanged = trimmed === server?.name;

  const handleSave = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server || !trimmed || unchanged || busy) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await renameServer(server.id, trimmed);
      queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((entry) => (entry.id === updated.id ? { ...entry, name: updated.name } : entry)));
      queryClient.setQueryData<ServerDetail>(['server', updated.id], (detail) => (detail ? { ...detail, name: updated.name } : detail));
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Server settings</DialogTitle>
            <DialogDescription>Only the server owner can change these settings.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="server-settings-name">Server name</Label>
            <Input id="server-settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={busy} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || unchanged || busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
