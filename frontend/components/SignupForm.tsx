import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useState } from 'react';
import { signup } from '@/api/api';
import { useRouter } from 'next/navigation';
import { useSettled } from '@/lib/useSettled';
import { PasswordInput } from './PasswordInput';

const PASSWORD_PATTERN = /^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/;
const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

export function SignupForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [usernameSettled, setUsernameSettled] = useSettled(username);
  const [passwordSettled, setPasswordSettled] = useSettled(password);
  const [password2Settled, setPassword2Settled] = useSettled(password2);

  const validUsername = username.length >= 3 && username.length <= 31 && USERNAME_PATTERN.test(username);
  const validPassword = password.length <= 255 && PASSWORD_PATTERN.test(password);
  const passwordsMatch = password2.length > 0 && password === password2;
  const showUsernameError = usernameSettled && username.length > 0 && !validUsername;
  const showPasswordError = passwordSettled && password.length > 0 && !validPassword;
  const showMismatch = password2Settled && password2.length > 0 && !passwordsMatch;

  const onSignup = async () => {
    if (!validUsername) {
      setUsernameSettled(true);
      toast.error('Invalid username', {
        description: 'Usernames must be 3-31 characters and only contain lowercase letters a-z, numbers, underscores and hyphens',
        duration: 4000,
      });

      return;
    }

    if (!validPassword) {
      setPasswordSettled(true);
      toast.error('Invalid password', {
        description: 'Passwords must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number and one special character',
        duration: 4000,
      });

      return;
    }

    if (!passwordsMatch) {
      setPassword2Settled(true);
      toast.error("Passwords don't match", {
        duration: 4000,
      });

      return;
    }

    const result = await signup(username, password);

    if (result && !result.success) {
      if (result.msg) {
        toast.error(String(result.msg), {
          duration: 4000,
        });
      }
    } else {
      toast.success('Successfully signed up', {
        duration: 4000,
      });

      router.push('/channels/@me');
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Sign up</CardTitle>
          <CardDescription>Enter a username and password below to register a new account</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              onSignup();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                maxLength={31}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  setUsernameSettled(false);
                }}
                onBlur={() => setUsernameSettled(true)}
                aria-invalid={showUsernameError}
              />
              {showUsernameError && <p className="text-destructive text-xs">Usernames must be 3-31 characters and only contain lowercase letters a-z, numbers, underscores and hyphens</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                maxLength={255}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordSettled(false);
                }}
                onBlur={() => setPasswordSettled(true)}
                aria-invalid={showPasswordError}
              />
              {showPasswordError && <p className="text-destructive text-xs">Password does not meet the requirements</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="passwordRepeat">Repeat password</Label>
              <PasswordInput
                id="passwordRepeat"
                autoComplete="new-password"
                maxLength={255}
                value={password2}
                onChange={(e) => {
                  setPassword2(e.target.value);
                  setPassword2Settled(false);
                }}
                onBlur={() => setPassword2Settled(true)}
                aria-invalid={showMismatch}
              />
              {passwordsMatch && <p className="text-xs text-green-600 dark:text-green-400">Passwords match</p>}
              {showMismatch && <p className="text-destructive text-xs">Passwords do not match</p>}
            </div>
            <p className="text-muted-foreground text-xs">At least 8 characters with upper and lower case, a number and a special character.</p>
            <Button type="submit" className="w-full" disabled={!validUsername || !validPassword || !passwordsMatch}>
              Sign up
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Already have an account?{' '}
            <a href="/login" className="underline underline-offset-4">
              Log in
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
