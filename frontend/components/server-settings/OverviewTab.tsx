'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, SubmitEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateServer } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { useReducedMotion } from '@/lib/avatarAnimation';
import { encodeImage, type ImageUpload } from '@/lib/imageUpload';
import type { Server, ServerDetail, ServerPatch } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ServerIcon } from '@/components/ServerIcon';

export function OverviewTab({ server }: { server: Server }) {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [name, setName] = useState(server.name);
  const [icon, setIcon] = useState<{ preview: string; upload: ImageUpload } | null>(null);
  const [iconRemoved, setIconRemoved] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const trimmed = name.trim();
  const hasIcon = icon !== null || (!iconRemoved && server.iconVersion != null);

  const patch: ServerPatch = {};
  if (trimmed !== server.name) patch.name = trimmed;
  if (icon) {
    patch.icon = icon.upload.image;
    if (icon.upload.poster) patch.iconPoster = icon.upload.poster;
  } else if (iconRemoved && server.iconVersion != null) {
    patch.icon = null;
  }

  const changed = Object.keys(patch).length > 0;

  const handleIconChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProcessing(true);
    setIconError(null);

    try {
      const upload = await encodeImage(file);

      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;

      let preview = upload.image;
      if (upload.poster) {
        if (reducedMotion) {
          preview = upload.poster;
        } else {
          preview = URL.createObjectURL(file);
          previewUrl.current = preview;
        }
      }

      setIcon({ preview, upload });
      setIconRemoved(false);
    } catch (caught) {
      setIconError(caught instanceof Error ? caught.message : 'Could not process that image');
    } finally {
      setProcessing(false);
    }
  };

  const handleIconRemove = () => {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }

    setIcon(null);
    setIconRemoved(server.iconVersion != null);
    setIconError(null);
  };

  const handleSave = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmed || !changed || busy || processing) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await updateServer(server.id, patch);
      queryClient.setQueryData<Server[]>(['servers'], (servers) => servers?.map((entry) => (entry.id === updated.id ? { ...entry, name: updated.name, iconVersion: updated.iconVersion } : entry)));
      queryClient.setQueryData<ServerDetail>(['server', updated.id], (detail) => (detail ? { ...detail, name: updated.name, iconVersion: updated.iconVersion } : detail));
      setName(updated.name);
      setIcon(null);
      setIconRemoved(false);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const previewServer = { ...server, iconVersion: iconRemoved ? null : server.iconVersion };

  return (
    <form onSubmit={handleSave} className="flex max-w-xl flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <ServerIcon server={previewServer} src={icon?.preview} className="size-12 shrink-0 rounded-full bg-sidebar-accent text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{trimmed || 'Server name'}</p>
          <p className="truncate text-xs text-muted-foreground">Server icon</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasIcon && (
            <Button type="button" variant="ghost" size="sm" onClick={handleIconRemove} disabled={busy || processing}>
              Remove
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy || processing}>
            {processing ? 'Processing...' : hasIcon ? 'Change' : 'Upload'}
          </Button>
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={handleIconChange} />
        </div>
      </div>

      {iconError && <p className="text-sm text-destructive">{iconError}</p>}
      <p className="text-xs text-muted-foreground">Static images up to 5 MB. Animated GIF or APNG up to 256x256 and 512 KB.</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="server-settings-name">Server name</Label>
        <Input id="server-settings-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={busy} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={!trimmed || !changed || busy || processing}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
