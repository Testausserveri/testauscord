'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { changePassword, getUser, updateProfile } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { logoutToLogin } from '@/lib/logout';
import { useSettled } from '@/lib/useSettled';
import type { CurrentUser } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { PasswordInput } from '@/components/PasswordInput';

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const PASSWORD_PATTERN = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/;

const isValidUsername = (value: string) => value.length >= 3 && value.length <= 31 && USERNAME_PATTERN.test(value);

export function MyAccountTab() {
  const { data: user } = useQuery<CurrentUser>({
    queryKey: ['user'],
    queryFn: getUser,
    staleTime: Infinity,
  });

  if (!user) return <p className="text-sm text-muted-foreground">Loading account...</p>;

  return <MyAccountForm user={user} />;
}

function MyAccountForm({ user }: { user: CurrentUser }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newSettled, setNewSettled] = useSettled(newPassword);
  const [confirmSettled, setConfirmSettled] = useSettled(confirmPassword);
  const [currentPasswordInvalid, setCurrentPasswordInvalid] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const usernameValid = isValidUsername(username);
  const showUsernameError = username.length > 0 && !usernameValid;
  const canSaveUsername = !usernameBusy && username !== user.username && usernameValid;

  const validPassword = newPassword.length <= 255 && PASSWORD_PATTERN.test(newPassword);
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword;
  const showPolicyError = newSettled && newPassword.length > 0 && !validPassword;
  const showMismatch = confirmSettled && confirmPassword.length > 0 && !passwordsMatch;

  const handleUsernameSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSaveUsername) return;

    setUsernameBusy(true);
    setUsernameError(null);
    try {
      const updated = await updateProfile({ username });
      queryClient.setQueryData<CurrentUser>(['user'], updated);
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', updated.id] });
      toast.success('Username updated');
    } catch (caught) {
      setUsernameError(apiErrorMessage(caught));
    } finally {
      setUsernameBusy(false);
    }
  };

  const handlePasswordSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordBusy) return;

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

    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      logoutToLogin('password');
    } catch (caught) {
      const message = apiErrorMessage(caught);
      toast.error(message);
      setCurrentPasswordInvalid(message === 'Incorrect password');
      setPasswordBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">My Account</h2>
        <p className="text-sm text-muted-foreground">Manage your username and password.</p>
      </div>

      <form onSubmit={handleUsernameSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="account-username">Username</Label>
          <Input
            id="account-username"
            autoComplete="username"
            maxLength={31}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={showUsernameError}
            disabled={usernameBusy}
          />
          {showUsernameError ? (
            <p className="text-xs text-destructive">Usernames must be 3-31 characters and only contain lowercase letters a-z, numbers, underscores and hyphens</p>
          ) : (
            <p className="text-xs text-muted-foreground">Lowercase letters, numbers, underscores and hyphens.</p>
          )}
        </div>
        {usernameError && <p className="text-sm text-destructive">{usernameError}</p>}
        <div>
          <Button type="submit" disabled={!canSaveUsername}>
            Save username
          </Button>
        </div>
      </form>

      <Separator />

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Change password</h3>
        <p className="text-xs text-muted-foreground">Changing your password signs you out of every session.</p>
      </div>

      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
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
            disabled={passwordBusy}
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
            disabled={passwordBusy}
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
            disabled={passwordBusy}
          />
          {showMismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
        </div>

        <p className="text-xs text-muted-foreground">At least 8 characters with upper and lower case, a number and a special character.</p>

        <div>
          <Button type="submit" disabled={passwordBusy || !currentPassword || !validPassword || !passwordsMatch}>
            Change password
          </Button>
        </div>
      </form>
    </div>
  );
}
