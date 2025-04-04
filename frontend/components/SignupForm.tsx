import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useState } from 'react';
import { signup } from '@/api/api';
import { useRouter } from 'next/navigation';

export function SignupForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  const onSignup = async () => {
    if (username.length < 3 || username.length > 31 || !/^[a-z0-9_-]+$/.test(username)) {
      toast.error('Invalid username', {
        description: 'Usernames must be 3-31 characters and only contain lowercase letters a-z, numbers, underscores and hyphens',
        duration: 4000,
      });

      return;
    }

    if (password.length < 8 || password.length > 255 || !/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/.test(password)) {
      toast.error('Invalid password', {
        description: 'Passwords must be at least 8 characters long and contain at least oneuppercase letter, one lowercase letter, one number and one special character',
        duration: 4000,
      });

      return;
    }

    if (password !== password2) {
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
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" type="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="passwordRepeat">Repeat password</Label>
              </div>
              <Input id="passwordRepeat" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </div>
            <Button className="w-full cursor-pointer" onClick={() => onSignup()}>
              Sign up
            </Button>
          </div>
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
