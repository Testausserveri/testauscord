'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getUser, updateProfile } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { CurrentUser } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function PrivacyTab() {
  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return <p className="text-sm text-muted-foreground">Loading privacy settings...</p>;

  return <PrivacyForm user={user} />;
}

function PrivacyForm({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const [allowDms, setAllowDms] = useState(user.allowDmsFromServerMembers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = allowDms !== user.allowDmsFromServerMembers;

  const handleSave = async () => {
    if (!changed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await updateProfile({ allowDmsFromServerMembers: allowDms });
      queryClient.setQueryData<CurrentUser>(['user'], updated);
      toast.success('Privacy settings updated');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Privacy &amp; Safety</h2>
        <p className="text-sm text-muted-foreground">Control who can contact you.</p>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="allow-dms-from-server-members">Direct messages from server members</Label>
          <Switch id="allow-dms-from-server-members" checked={allowDms} onCheckedChange={setAllowDms} disabled={busy} />
        </div>
        <p className="text-xs text-muted-foreground">Let members of your servers start a direct message with you even if you are not friends.</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div>
        <Button type="button" onClick={handleSave} disabled={!changed || busy}>
          Save
        </Button>
      </div>
    </div>
  );
}
