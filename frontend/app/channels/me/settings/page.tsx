'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppearanceTab } from '@/components/settings/AppearanceTab';
import { MyAccountTab } from '@/components/settings/MyAccountTab';
import { PrivacyTab } from '@/components/settings/PrivacyTab';
import { ProfileTab } from '@/components/settings/ProfileTab';
import { SessionsTab } from '@/components/settings/SessionsTab';

const TABS = ['account', 'profile', 'privacy', 'sessions', 'appearance'] as const;
type SettingsTab = (typeof TABS)[number];

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
          <TabsTrigger value="privacy" className="h-9 flex-1 justify-start md:flex-none">
            Privacy &amp; Safety
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
            <MyAccountTab />
          </TabsContent>

          <TabsContent value="profile" className="min-w-0 flex-1">
            <ProfileTab />
          </TabsContent>

          <TabsContent value="privacy" className="min-w-0 flex-1">
            <PrivacyTab />
          </TabsContent>

          <TabsContent value="sessions" className="min-w-0 flex-1">
            <SessionsTab />
          </TabsContent>

          <TabsContent value="appearance" className="min-w-0 flex-1">
            <AppearanceTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
