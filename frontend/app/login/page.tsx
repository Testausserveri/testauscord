'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { LoginForm } from '@/components/LoginForm';
import { takeLogoutToast } from '@/lib/logout';

export default function Login() {
  useEffect(() => {
    const pending = takeLogoutToast();
    if (!pending) return;

    if (pending.type === 'success') toast.success(pending.message);
    else toast.info(pending.message);
  }, []);

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  );
}
