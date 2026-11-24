'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent, SubmitEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getUser, updateProfile } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { useSettled } from '@/lib/useSettled';
import type { CurrentUser, ProfilePatch } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { UserAvatar } from './UserAvatar';

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BYTES = 128 * 1024;
const AVATAR_SIZE = 256;

const isValidUsername = (value: string) => value.length >= 3 && value.length <= 31 && USERNAME_PATTERN.test(value);

const hasUnsafeChars = (value: string) => CONTROL_CHARS.test(value) || BIDI_CONTROLS.test(value);

const dataUrlBytes = (value: string) => Math.floor(((value.length - value.indexOf(',') - 1) * 3) / 4);

const encodeAvatar = async (file: File): Promise<string> => {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Images must be 5 MB or smaller');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not a supported image');
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('Could not process that image');
  }

  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  for (const [type, quality] of [
    ['image/webp', 0.85],
    ['image/webp', 0.7],
    ['image/webp', 0.5],
    ['image/jpeg', 0.85],
  ] as const) {
    const dataUrl = canvas.toDataURL(type, quality);
    if (!dataUrl.startsWith(`data:${type}`)) continue;
    if (dataUrlBytes(dataUrl) <= MAX_AVATAR_BYTES) return dataUrl;
  }

  throw new Error('Could not shrink that image below 128 KB');
};

export function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return null;

  return <EditProfileForm user={user} onClose={onClose} />;
}

function EditProfileForm({ user, onClose }: { user: CurrentUser; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<{ dataUrl: string | null; removed: boolean }>({ dataUrl: null, removed: false });
  const [usernameSettled, setUsernameSettled] = useSettled(username);
  const [displayNameSettled, setDisplayNameSettled] = useSettled(displayName);
  const [bioSettled, setBioSettled] = useSettled(bio);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nextDisplayName = displayName.trim();
  const nextBio = bio.replace(/\r\n/g, '\n').trimEnd();

  const usernameValid = isValidUsername(username);
  const displayNameValid = nextDisplayName.length <= 32 && !hasUnsafeChars(nextDisplayName);
  const bioValid = nextBio.length <= 190 && !hasUnsafeChars(nextBio.replace(/\n/g, ''));

  const showUsernameError = usernameSettled && username.length > 0 && !usernameValid;
  const showDisplayNameError = displayNameSettled && nextDisplayName.length > 0 && !displayNameValid;
  const showBioError = bioSettled && nextBio.length > 0 && !bioValid;

  const hasAvatar = avatar.dataUrl !== null || (!avatar.removed && user.avatarVersion != null);
  const previewUser = { id: user.id, username, displayName: nextDisplayName || null, avatarVersion: avatar.dataUrl !== null || avatar.removed ? null : user.avatarVersion };

  const patch: ProfilePatch = {};

  if (username !== user.username) patch.username = username;
  if (nextDisplayName !== (user.displayName ?? '')) patch.displayName = nextDisplayName || null;
  if ((nextBio || null) !== user.bio) patch.bio = nextBio || null;
  if (avatar.dataUrl !== null) patch.avatar = avatar.dataUrl;
  else if (avatar.removed && user.avatarVersion != null) patch.avatar = null;

  const changed = Object.keys(patch).length > 0;
  const canSave = !busy && !processing && changed && usernameValid && displayNameValid && bioValid;

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProcessing(true);
    setAvatarError(null);

    try {
      const dataUrl = await encodeAvatar(file);
      setAvatar({ dataUrl, removed: false });
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : 'Could not process that image');
    } finally {
      setProcessing(false);
    }
  };

  const handleAvatarRemove = () => {
    setAvatar({ dataUrl: null, removed: user.avatarVersion != null });
    setAvatarError(null);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);
    try {
      const updated = await updateProfile(patch);
      queryClient.setQueryData<CurrentUser>(['user'], updated);
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', updated.id] });
      toast.success('Profile updated');
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>This is how other people see you.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-3 rounded-md border p-3">
            <UserAvatar user={previewUser} src={avatar.dataUrl ?? undefined} className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nextDisplayName || username || 'Your name'}</p>
              <p className="truncate text-xs text-muted-foreground">@{username || 'username'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasAvatar && (
                <Button type="button" variant="ghost" size="sm" onClick={handleAvatarRemove} disabled={busy || processing}>
                  Remove
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy || processing}>
                {processing ? 'Processing...' : hasAvatar ? 'Change' : 'Upload'}
              </Button>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
          </div>

          {avatarError && <p className="text-sm text-destructive">{avatarError}</p>}

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-username">Username</Label>
            <Input
              id="profile-username"
              autoComplete="username"
              maxLength={31}
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setUsernameSettled(false);
              }}
              onBlur={() => setUsernameSettled(true)}
              aria-invalid={showUsernameError}
              disabled={busy}
            />
            {showUsernameError ? (
              <p className="text-xs text-destructive">Usernames must be 3-31 characters and only contain lowercase letters a-z, numbers, underscores and hyphens</p>
            ) : (
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores and hyphens.</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="profile-display-name">Display name</Label>
              <span className="text-xs text-muted-foreground">{nextDisplayName.length}/32</span>
            </div>
            <Input
              id="profile-display-name"
              autoComplete="nickname"
              maxLength={32}
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setDisplayNameSettled(false);
              }}
              onBlur={() => setDisplayNameSettled(true)}
              placeholder={user.username}
              aria-invalid={showDisplayNameError}
              disabled={busy}
            />
            {showDisplayNameError && <p className="text-xs text-destructive">Display names cannot contain control characters</p>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="profile-bio">Bio</Label>
              <span className="text-xs text-muted-foreground">{nextBio.length}/190</span>
            </div>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={(event) => {
                setBio(event.target.value);
                setBioSettled(false);
              }}
              onBlur={() => setBioSettled(true)}
              maxLength={190}
              rows={4}
              disabled={busy}
              aria-invalid={showBioError}
              className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:ring-destructive/40"
            />
            {showBioError && <p className="text-xs text-destructive">Bios cannot contain control characters</p>}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
