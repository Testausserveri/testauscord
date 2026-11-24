'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { changePassword, getSessions, getUser, revokeAllSessions, revokeSession } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { logoutToLogin } from '@/lib/logout';
import { useSettled } from '@/lib/useSettled';
import type { AccountSession, CurrentUser } from '@/types/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { PasswordInput } from './PasswordInput';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';

const PASSWORD_PATTERN = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/;

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const describeUserAgent = (userAgent: string | null) => {
  if (!userAgent) return 'Unknown device';

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];

  return system ? `${browser} on ${system}` : browser;
};

const formatSessionDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AccountSettingsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { openEditProfile } = useProfilePopover();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newSettled, setNewSettled] = useSettled(newPassword);
  const [confirmSettled, setConfirmSettled] = useSettled(confirmPassword);
  const [currentPasswordInvalid, setCurrentPasswordInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | 'all' | null>(null);

  const { data: sessions, isPending: sessionsPending } = useQuery<AccountSession[]>({
    queryKey: ['account-sessions'],
    queryFn: getSessions,
    enabled: open,
  });

  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  const validPassword = newPassword.length <= 255 && PASSWORD_PATTERN.test(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const showPolicyError = newSettled && newPassword.length > 0 && !validPassword;
  const showMismatch = confirmSettled && confirmPassword.length > 0 && !passwordsMatch;

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setNewSettled(false);
    setConfirmSettled(false);
    setCurrentPasswordInvalid(false);
    setBusy(false);
    setRevoking(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    if (newPassword.length < 8 || newPassword.length > 255 || !PASSWORD_PATTERN.test(newPassword)) {
      setNewSettled(true);
      toast.error('Invalid password');
      return;
    }

    if (newPassword !== confirmPassword) {
      setConfirmSettled(true);
      toast.error("Passwords don't match");
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      logoutToLogin('password');
    } catch (caught) {
      const message = apiErrorMessage(caught);
      toast.error(message);
      setCurrentPasswordInvalid(message === 'Incorrect password');
      setBusy(false);
    }
  };

  const handleRevoke = async (session: AccountSession) => {
    if (revoking) return;

    setRevoking(session.id);
    try {
      await revokeSession(session.id);

      if (session.current) {
        logoutToLogin('logout');
        return;
      }

      toast.success('Session revoked');
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    if (revoking || !sessions?.length) return;

    setRevoking('all');
    try {
      await revokeAllSessions();
      logoutToLogin('logout');
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
      setRevoking(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Manage your profile, password and signed-in sessions.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3">
          {user && <UserAvatar user={user} className="h-12 w-12" />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user ? (user.displayName ?? user.username) : 'Loading profile...'}</p>
            {user && <p className="truncate text-xs text-muted-foreground">@{user.username}</p>}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={openEditProfile} disabled={!user}>
            Edit profile
          </Button>
        </div>

        <Separator />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Change password</h3>
            <p className="text-xs text-muted-foreground">Changing your password signs you out of every session.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              autoComplete="current-password"
              maxLength={255}
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                setCurrentPasswordInvalid(false);
              }}
              aria-invalid={currentPasswordInvalid}
              disabled={busy}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="new-password">New password</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              maxLength={255}
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setNewSettled(false);
              }}
              onBlur={() => setNewSettled(true)}
              aria-invalid={showPolicyError}
              disabled={busy}
            />
            {showPolicyError && <p className="text-xs text-destructive">Password does not meet the requirements</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <PasswordInput
              id="confirm-password"
              autoComplete="new-password"
              maxLength={255}
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setConfirmSettled(false);
              }}
              onBlur={() => setConfirmSettled(true)}
              aria-invalid={showMismatch}
              disabled={busy}
            />
            {showMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
          </div>

          <p className="text-xs text-muted-foreground">At least 8 characters with upper and lower case, a number and a special character.</p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !currentPassword || !validPassword || !passwordsMatch}>
              Change password
            </Button>
          </DialogFooter>
        </form>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">Sessions</h3>
              <p className="text-xs text-muted-foreground">Devices currently signed in to your account.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleRevokeAll} disabled={revoking !== null || !sessions?.length}>
              Sign out all
            </Button>
          </div>

          {sessionsPending ? (
            <p className="text-sm text-muted-foreground">Loading sessions...</p>
          ) : sessions?.length ? (
            <ul className="flex flex-col divide-y rounded-md border">
              {sessions.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {describeUserAgent(session.userAgent)}
                      {session.current && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">This device</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">Signed in {formatSessionDate(session.createdAt)}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleRevoke(session)} disabled={revoking !== null}>
                    {revoking === session.id ? 'Revoking...' : session.current ? 'Sign out' : 'Revoke'}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
