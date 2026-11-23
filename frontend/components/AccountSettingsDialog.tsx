'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { toast } from 'sonner';
import { changePassword } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { useSettled } from '@/lib/useSettled';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Label } from './ui/label';
import { PasswordInput } from './PasswordInput';

const PASSWORD_PATTERN = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AccountSettingsDialog({ open, onOpenChange }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newSettled, setNewSettled] = useSettled(newPassword);
  const [confirmSettled, setConfirmSettled] = useSettled(confirmPassword);
  const [currentPasswordInvalid, setCurrentPasswordInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

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
      toast.success('Password changed. Other sessions were signed out.');
      reset();
      onOpenChange(false);
    } catch (caught) {
      const message = apiErrorMessage(caught);
      toast.error(message);
      setCurrentPasswordInvalid(message === 'Incorrect password');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Account settings</DialogTitle>
            <DialogDescription>Change your password. All other sessions will be signed out.</DialogDescription>
          </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
