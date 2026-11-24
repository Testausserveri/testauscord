'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
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

const isValidUsername = (value: string) => value.length >= 3 && value.length <= 31 && USERNAME_PATTERN.test(value);

const hasUnsafeChars = (value: string) => CONTROL_CHARS.test(value) || BIDI_CONTROLS.test(value);

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
  const [username, setUsername] = useState(user.username);
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [usernameSettled, setUsernameSettled] = useSettled(username);
  const [displayNameSettled, setDisplayNameSettled] = useSettled(displayName);
  const [bioSettled, setBioSettled] = useSettled(bio);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextDisplayName = displayName.trim();
  const nextBio = bio.replace(/\r\n/g, '\n').trimEnd();

  const usernameValid = isValidUsername(username);
  const displayNameValid = nextDisplayName.length <= 32 && !hasUnsafeChars(nextDisplayName);
  const bioValid = nextBio.length <= 190 && !hasUnsafeChars(nextBio.replace(/\n/g, ''));

  const showUsernameError = usernameSettled && username.length > 0 && !usernameValid;
  const showDisplayNameError = displayNameSettled && nextDisplayName.length > 0 && !displayNameValid;
  const showBioError = bioSettled && nextBio.length > 0 && !bioValid;

  const patch: ProfilePatch = {};

  if (username !== user.username) patch.username = username;
  if (nextDisplayName !== (user.displayName ?? '')) patch.displayName = nextDisplayName || null;
  if ((nextBio || null) !== user.bio) patch.bio = nextBio || null;

  const changed = Object.keys(patch).length > 0;
  const canSave = !busy && changed && usernameValid && displayNameValid && bioValid;

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
            <UserAvatar user={{ id: user.id, username, displayName: nextDisplayName || null }} className="h-12 w-12" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{nextDisplayName || username || 'Your name'}</p>
              <p className="truncate text-xs text-muted-foreground">@{username || 'username'}</p>
            </div>
          </div>

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
