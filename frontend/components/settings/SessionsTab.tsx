'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getSessions, revokeAllSessions, revokeSession } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import { logoutToLogin } from '@/lib/logout';
import type { AccountSession } from '@/types/types';
import { Button } from '@/components/ui/button';

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const describeUserAgent = (userAgent: string | null) => {
  if (!userAgent) return 'Unknown device';

  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];

  return system ? `${browser} on ${system}` : browser;
};

const formatSessionDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function SessionsTab() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string | 'all' | null>(null);

  const { data: sessions, isPending } = useQuery<AccountSession[]>({
    queryKey: ['account-sessions'],
    queryFn: getSessions,
  });

  const handleRevoke = async (session: AccountSession) => {
    if (revoking) return;

    setRevoking(session.id);
    try {
      await revokeSession(session.id);

      if (session.current) {
        logoutToLogin('logout');
        return;
      }

      toast.success('Session revoked');
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    if (revoking || !sessions?.length) return;

    setRevoking('all');
    try {
      await revokeAllSessions();
      logoutToLogin('logout');
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
      setRevoking(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Sessions</h2>
          <p className="text-sm text-muted-foreground">Devices currently signed in to your account.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleRevokeAll} disabled={revoking !== null || !sessions?.length}>
          Sign out all
        </Button>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading sessions...</p>
      ) : sessions?.length ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {describeUserAgent(session.userAgent)}
                  {session.current && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">This device</span>}
                </p>
                <p className="text-xs text-muted-foreground">Signed in {formatSessionDate(session.createdAt)}</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => handleRevoke(session)} disabled={revoking !== null}>
                {revoking === session.id ? 'Revoking...' : session.current ? 'Sign out' : 'Revoke'}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      )}
    </div>
  );
}
