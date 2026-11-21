'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createInvite, leaveServer } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { Server, ServerAction } from '@/types/types';
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

  const close = () => {
    setInvite(null);
    setCopied(false);
    setBusy(false);
    setError(null);
    onClose();
  };

  const serverId = server?.id;

  useEffect(() => {
    if (action !== 'invite' || !serverId) return;

    let active = true;
    createInvite(serverId)
      .then((result) => {
        if (active) setInvite(result.code);
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
              Share this code so others can join <b>{server?.name}</b>.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={invite ?? ''} placeholder={error ? '' : 'Creating invite...'} onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="secondary" onClick={handleCopyInvite} disabled={!invite}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
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
