import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useState } from 'react';
import { login } from '@/api/api';
import { useRouter } from 'next/navigation';

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const onLogin = async () => {
    if (username.length < 3 || username.length > 31 || !/^[a-z0-9_-]+$/.test(username)) {
      toast.error('Invalid username');

      return;
    }

    if (password.length < 8 || password.length > 255 || !/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$/.test(password)) {
      toast.error('Invalid password');

      return;
    }

    const result = await login(username, password);

    if (result && !result.success) {
      if (result.msg) {
        toast.error(String(result.msg));
      }
    } else {
      toast.success('Successfully logged in');

      router.push('/channels/@me');
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your username and password below to login to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" type="username" onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
              </div>
              <Input id="password" type="password" onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button className="w-full cursor-pointer" onClick={() => onLogin()}>
              Login
            </Button>
          </div>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{' '}
            <a href="/signup" className="underline underline-offset-4">
              Sign up
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
