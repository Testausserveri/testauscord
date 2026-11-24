'use client';

import { useState } from 'react';
import type { SubmitEvent } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { cancelFriendRequest, getFriends, getPendingRequests, getSentRequests, respondToFriendRequest, sendFriendRequest } from '@/api/api';
import { apiErrorMessage } from '@/lib/apiError';
import type { Friend, IncomingFriendRequest, OutgoingFriendRequest } from '@/types/types';
import { FriendsList } from './FriendsList';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const USERNAME_PATTERN = /^[a-z0-9_-]+$/;
const isValidUsername = (value: string) => value.length >= 3 && value.length <= 31 && USERNAME_PATTERN.test(value);

const isNotFound = (error: unknown) => axios.isAxiosError(error) && error.response?.status === 404;

const sentDate = (value: string) => new Date(value).toLocaleDateString();

export function FriendsPage() {
  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b flex items-center gap-2">
        <Users className="!h-6 !w-6" />
        <h1 className="font-semibold">Friends</h1>
      </header>

      <Tabs defaultValue="all" className="flex-1 min-h-0">
        <div className="px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="add">Add Friend</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all" className="flex-1 overflow-auto p-4">
          <FriendsList />
        </TabsContent>

        <TabsContent value="pending" className="flex-1 overflow-auto p-4">
          <PendingRequests />
        </TabsContent>

        <TabsContent value="add" className="p-4">
          <AddFriendForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddFriendForm() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: friends } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  const { data: sent } = useQuery<OutgoingFriendRequest[]>({
    queryKey: ['friend-requests-sent'],
    queryFn: getSentRequests,
    staleTime: 1000 * 20,
  });

  const label = username.trim();
  const valid = isValidUsername(label);

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || busy) return;

    setMessage(null);
    setError(null);

    if (friends?.some((entry) => entry.friend.username === label)) {
      setMessage(`You are already friends with @${label}`);
      return;
    }

    if (sent?.some((entry) => entry.receiver.username === label)) {
      setMessage(`You already have a pending request to @${label}`);
      return;
    }

    setBusy(true);
    try {
      setMessage(await sendFriendRequest(label));
      setUsername('');
      void queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] });
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Add Friend</h2>
      <p className="text-sm text-muted-foreground">You can add friends with their username.</p>
      <div className="flex gap-2">
        <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter a username" maxLength={31} disabled={busy} aria-label="Username" />
        <Button type="submit" disabled={!valid || busy}>
          Send Friend Request
        </Button>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

function PendingRequests() {
  const queryClient = useQueryClient();
  const [bulkBusy, setBulkBusy] = useState(false);

  const { data: incoming, isPending: incomingPending } = useQuery<IncomingFriendRequest[]>({
    queryKey: ['friend-requests-pending'],
    queryFn: getPendingRequests,
    staleTime: 1000 * 20,
  });

  const { data: outgoing, isPending: outgoingPending } = useQuery<OutgoingFriendRequest[]>({
    queryKey: ['friend-requests-sent'],
    queryFn: getSentRequests,
    staleTime: 1000 * 20,
  });

  const incomingSorted = incoming ? [...incoming].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : undefined;
  const outgoingSorted = outgoing ? [...outgoing].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : undefined;

  const refreshLists = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['friend-requests-pending'] }), queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] })]);

  const runBulk = async (requests: { id: string }[], action: 'reject' | 'cancel') => {
    if (bulkBusy || requests.length === 0) return;
    setBulkBusy(true);

    const results = await Promise.allSettled(requests.map((request) => (action === 'reject' ? respondToFriendRequest(request.id, false) : cancelFriendRequest(request.id))));

    if (results.some((result) => result.status === 'rejected' && !isNotFound(result.reason))) {
      toast.error(action === 'reject' ? 'Could not reject every request' : 'Could not cancel every request');
    }

    await refreshLists();
    setBulkBusy(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">INCOMING — {incoming?.length ?? 0}</h3>
          {incomingSorted?.length ? (
            <Button size="sm" variant="outline" onClick={() => runBulk(incomingSorted, 'reject')} disabled={bulkBusy}>
              Reject all
            </Button>
          ) : null}
        </div>
        {incomingPending ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : incomingSorted?.length ? (
          <div className="gap-1 flex flex-col">
            {incomingSorted.map((request) => (
              <IncomingRow key={request.id} request={request} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No incoming friend requests.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">OUTGOING — {outgoing?.length ?? 0}</h3>
          {outgoingSorted?.length ? (
            <Button size="sm" variant="outline" onClick={() => runBulk(outgoingSorted, 'cancel')} disabled={bulkBusy}>
              Cancel all
            </Button>
          ) : null}
        </div>
        {outgoingPending ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : outgoingSorted?.length ? (
          <div className="gap-1 flex flex-col">
            {outgoingSorted.map((request) => (
              <OutgoingRow key={request.id} request={request} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No outgoing friend requests.</p>
        )}
      </section>
    </div>
  );
}

function IncomingRow({ request }: { request: IncomingFriendRequest }) {
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const [busy, setBusy] = useState(false);

  const respond = async (accepted: boolean) => {
    if (busy) return;
    setBusy(true);

    try {
      await respondToFriendRequest(request.id, accepted);
    } catch (caught) {
      if (!isNotFound(caught)) {
        toast.error(apiErrorMessage(caught));
        setBusy(false);
        return;
      }
    }

    void queryClient.invalidateQueries({ queryKey: ['friend-requests-pending'] });
    void queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] });
    if (accepted) void queryClient.invalidateQueries({ queryKey: ['friends'] });
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg p-3 hover:bg-accent">
      <button type="button" onClick={(event) => openProfile(request.sender.id, event.currentTarget)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <UserAvatar user={request.sender} className="h-8 w-8" />
        <div className="min-w-0">
          <p className="font-semibold truncate">{request.sender.displayName ?? request.sender.username}</p>
          <p className="text-xs text-muted-foreground truncate">@{request.sender.username}</p>
        </div>
      </button>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => respond(true)} disabled={busy}>
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={() => respond(false)} disabled={busy}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function OutgoingRow({ request }: { request: OutgoingFriendRequest }) {
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();
  const [busy, setBusy] = useState(false);

  const cancel = async () => {
    if (busy) return;
    setBusy(true);

    try {
      await cancelFriendRequest(request.id);
    } catch (caught) {
      if (!isNotFound(caught)) {
        toast.error(apiErrorMessage(caught));
        setBusy(false);
        return;
      }
    }

    void queryClient.invalidateQueries({ queryKey: ['friend-requests-pending'] });
    void queryClient.invalidateQueries({ queryKey: ['friend-requests-sent'] });
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg p-3 hover:bg-accent">
      <button type="button" onClick={(event) => openProfile(request.receiver.id, event.currentTarget)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <UserAvatar user={request.receiver} className="h-8 w-8" />
        <div className="min-w-0">
          <p className="font-semibold truncate">{request.receiver.displayName ?? request.receiver.username}</p>
          <p className="text-xs text-muted-foreground truncate">Sent {sentDate(request.createdAt)}</p>
        </div>
      </button>
      <Button size="sm" variant="outline" onClick={cancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  );
}
