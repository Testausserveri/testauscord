'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b">
      <div className="max-w-2xl text-center space-y-8">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">Testauscord</h1>

        <div className="mt-10">
          <Button
            size="lg"
            className="px-8 py-6 text-lg cursor-pointer"
            onClick={() => {
              router.push('/login');
            }}
          >
            Login
          </Button>
        </div>
      </div>
    </div>
  );
}
