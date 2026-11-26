'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TABS = ['account', 'profile', 'sessions', 'appearance'] as const;
type SettingsTab = (typeof TABS)[number];

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const isSettingsTab = (value: string | null): value is SettingsTab => value !== null && TABS.includes(value as SettingsTab);

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading settings...</div>}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const requested = searchParams.get('tab');
  const [tab, setTab] = useState<SettingsTab>(isSettingsTab(requested) ? requested : 'account');

  const selectTab = (value: SettingsTab) => {
    if (value === tab) return;
    setTab(value);
    router.replace(`/channels/@me/settings?tab=${value}`, { scroll: false });
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/channels/@me');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b p-4">
        <Button type="button" variant="ghost" size="icon" onClick={goBack} title="Back" aria-label="Back">
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>

      <Tabs value={tab} onValueChange={(value) => selectTab(value as SettingsTab)} orientation="vertical" className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">
        <TabsList className="h-auto w-full shrink-0 flex-row justify-start overflow-x-auto rounded-none border-b bg-sidebar p-2 md:h-full md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0">
          <TabsTrigger value="account" className="h-9 flex-1 justify-start md:flex-none">
            My Account
          </TabsTrigger>
          <TabsTrigger value="profile" className="h-9 flex-1 justify-start md:flex-none">
            Profile
          </TabsTrigger>
          <TabsTrigger value="sessions" className="h-9 flex-1 justify-start md:flex-none">
            Sessions
          </TabsTrigger>
          <TabsTrigger value="appearance" className="h-9 flex-1 justify-start md:flex-none">
            Appearance
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
          <TabsContent value="account" className="min-w-0 flex-1">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">My Account</h2>
              <p className="text-sm text-muted-foreground">TODO</p>
            </div>
          </TabsContent>

          <TabsContent value="profile" className="min-w-0 flex-1">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Profile</h2>
              <p className="text-sm text-muted-foreground">TODO</p>
            </div>
          </TabsContent>

          <TabsContent value="sessions" className="min-w-0 flex-1">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Sessions</h2>
              <p className="text-sm text-muted-foreground">TODO</p>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="min-w-0 flex-1">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h2 className="text-lg font-semibold">Appearance</h2>
                <p className="text-sm text-muted-foreground">Choose how Testauscord looks.</p>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Theme</span>
                <div className="flex gap-2">
                  {THEMES.map((option) => (
                    <Button key={option.value} type="button" variant={theme === option.value ? 'default' : 'outline'} onClick={() => setTheme(option.value)}>
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
