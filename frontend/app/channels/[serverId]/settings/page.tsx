'use client';

import { Suspense, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { getServer, getServers } from '@/api/api';
import { firstChannel } from '@/lib/serverRoutes';
import { serverSettingsTabs } from '@/lib/serverSettings';
import type { ServerSettingsTab } from '@/lib/serverSettings';
import type { Server, ServerDetail } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OverviewTab } from '@/components/server-settings/OverviewTab';
import { RolesTab } from '@/components/server-settings/RolesTab';
import { MembersTab } from '@/components/server-settings/MembersTab';
import { InvitesTab } from '@/components/server-settings/InvitesTab';

const TABS: ServerSettingsTab[] = ['overview', 'roles', 'members', 'invites'];
const TAB_LABELS: Record<ServerSettingsTab, string> = { overview: 'Overview', roles: 'Roles', members: 'Members', invites: 'Invites' };

const isServerSettingsTab = (value: string | null): value is ServerSettingsTab => value !== null && TABS.includes(value as ServerSettingsTab);

export default function ServerSettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading settings...</div>}>
      <ServerSettingsContent />
    </Suspense>
  );
}

function ServerSettingsContent() {
  const { serverId } = useParams<{ serverId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const [tab, setTab] = useState<ServerSettingsTab>(isServerSettingsTab(requested) ? requested : 'overview');

  const { data: servers } = useQuery<Server[]>({
    queryKey: ['servers'],
    queryFn: getServers,
    staleTime: 1000 * 20,
  });

  const server = servers?.find((entry) => entry.id === serverId);
  const availableTabs = server ? serverSettingsTabs(server) : [];
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];
  const needsDetail = activeTab === 'roles' || activeTab === 'members';

  const { data: detail, isPending: detailPending } = useQuery<ServerDetail>({
    queryKey: ['server', serverId],
    queryFn: () => getServer(serverId),
    enabled: needsDetail && Boolean(server),
    staleTime: 1000 * 20,
  });

  const selectTab = (value: ServerSettingsTab) => {
    if (value === activeTab) return;
    setTab(value);
    router.replace(`/channels/${serverId}/settings?tab=${value}`, { scroll: false });
  };

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    const channel = server ? firstChannel(server) : undefined;
    router.push(channel ? `/channels/${serverId}/${channel.id}` : '/channels/@me');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b p-4">
        <Button type="button" variant="ghost" size="icon" onClick={goBack} title="Back" aria-label="Back">
          <ArrowLeft />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Server settings</h1>
          {server && <p className="truncate text-xs text-muted-foreground">{server.name}</p>}
        </div>
      </header>

      {!servers ? (
        <p className="p-6 text-sm text-muted-foreground">Loading settings...</p>
      ) : !server ? (
        <p className="p-6 text-sm text-muted-foreground">Server not found.</p>
      ) : !activeTab ? (
        <p className="p-6 text-sm text-muted-foreground">You do not have permission to manage this server.</p>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => selectTab(value as ServerSettingsTab)} orientation="vertical" className="flex min-h-0 flex-1 flex-col gap-0 md:flex-row">
          <TabsList className="h-auto w-full shrink-0 flex-row justify-start overflow-x-auto rounded-none border-b bg-sidebar p-2 md:h-full md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0">
            {availableTabs.map((value) => (
              <TabsTrigger key={value} value={value} className="h-9 flex-1 justify-start md:flex-none">
                {TAB_LABELS[value]}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <TabsContent value="overview" className="min-w-0 flex-1">
              <OverviewTab server={server} />
            </TabsContent>
            <TabsContent value="roles" className="min-w-0 flex-1">
              {detailPending ? (
                <p className="text-sm text-muted-foreground">Loading roles...</p>
              ) : detail ? (
                <RolesTab server={server} roles={detail.roles} />
              ) : (
                <p className="text-sm text-muted-foreground">Roles unavailable.</p>
              )}
            </TabsContent>
            <TabsContent value="members" className="min-w-0 flex-1">
              {detailPending ? (
                <p className="text-sm text-muted-foreground">Loading members...</p>
              ) : detail ? (
                <MembersTab server={server} detail={detail} />
              ) : (
                <p className="text-sm text-muted-foreground">Members unavailable.</p>
              )}
            </TabsContent>
            <TabsContent value="invites" className="min-w-0 flex-1">
              <InvitesTab server={server} />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}
