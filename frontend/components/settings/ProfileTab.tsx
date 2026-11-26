'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, SubmitEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getUser, updateProfile } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { encodeAvatar, type AvatarUpload } from '@/lib/imageUpload';
import { useSettled } from '@/lib/useSettled';
import type { CurrentUser, ProfilePatch } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserAvatar } from '@/components/UserAvatar';

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;

const hasUnsafeChars = (value: string) => CONTROL_CHARS.test(value) || BIDI_CONTROLS.test(value);

export function ProfileTab() {
  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return <p className="text-sm text-muted-foreground">Loading profile...</p>;

  return <ProfileForm user={user} />;
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<{ preview: string; upload: AvatarUpload } | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [displayNameSettled, setDisplayNameSettled] = useSettled(displayName);
  const [bioSettled, setBioSettled] = useSettled(bio);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  const nextDisplayName = displayName.trim();
  const nextBio = bio.replace(/\r\n/g, '\n').trimEnd();

  const displayNameValid = nextDisplayName.length <= 32 && !hasUnsafeChars(nextDisplayName);
  const bioValid = nextBio.length <= 190 && !hasUnsafeChars(nextBio.replace(/\n/g, ''));

  const showDisplayNameError = displayNameSettled && nextDisplayName.length > 0 && !displayNameValid;
  const showBioError = bioSettled && nextBio.length > 0 && !bioValid;

  const hasAvatar = avatar !== null || (!avatarRemoved && user.avatarVersion != null);
  const previewUser = { id: user.id, username: user.username, displayName: nextDisplayName || null, avatarVersion: avatar !== null || avatarRemoved ? null : user.avatarVersion };

  const patch: ProfilePatch = {};

  if (nextDisplayName !== (user.displayName ?? '')) patch.displayName = nextDisplayName || null;
  if ((nextBio || null) !== user.bio) patch.bio = nextBio || null;
  if (avatar) {
    patch.avatar = avatar.upload.avatar;
    if (avatar.upload.poster) patch.avatarPoster = avatar.upload.poster;
  } else if (avatarRemoved && user.avatarVersion != null) {
    patch.avatar = null;
  }

  const changed = Object.keys(patch).length > 0;
  const canSave = !busy && !processing && changed && displayNameValid && bioValid;

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setProcessing(true);
    setAvatarError(null);

    try {
      const upload = await encodeAvatar(file);

      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;

      let preview = upload.avatar;
      if (upload.poster) {
        preview = URL.createObjectURL(file);
        previewUrl.current = preview;
      }

      setAvatar({ preview, upload });
      setAvatarRemoved(false);
    } catch (caught) {
      setAvatarError(caught instanceof Error ? caught.message : 'Could not process that image');
    } finally {
      setProcessing(false);
    }
  };

  const handleAvatarRemove = () => {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }

    setAvatar(null);
    setAvatarRemoved(user.avatarVersion != null);
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
      setDisplayName(updated.displayName ?? '');
      setBio(updated.bio ?? '');

      if (previewUrl.current) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }

      setAvatar(null);
      setAvatarRemoved(false);
      toast.success('Profile updated');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Profile</h2>
        <p className="text-sm text-muted-foreground">This is how other people see you.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-md border p-3">
          <UserAvatar user={previewUser} src={avatar?.preview} alwaysAnimate className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{nextDisplayName || user.username || 'Your name'}</p>
            <p className="truncate text-xs text-muted-foreground">@{user.username || 'username'}</p>
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
        <p className="text-xs text-muted-foreground">Static images up to 5 MB. Animated GIF or APNG up to 256x256 and 512 KB.</p>

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

        <div>
          <Button type="submit" disabled={!canSave}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
