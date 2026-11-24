'use client';

import { useEffect } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import type { CurrentUser, Message, UserRef } from '@/types/types';

type MessagesPage = {
  messages: Message[];
  nextCursor: string | null;
};

const patchMessageSenders = (data: InfiniteData<MessagesPage> | undefined, user: UserRef) => {
  if (!data) return data;

  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const messages = page.messages.map((message) => {
      if (message.sender.id !== user.id) return message;
      if (message.sender.username === user.username && message.sender.displayName === user.displayName && message.sender.avatarVersion === user.avatarVersion) return message;

      pageChanged = true;
      return { ...message, sender: { ...message.sender, username: user.username, displayName: user.displayName, avatarVersion: user.avatarVersion } };
    });

    if (!pageChanged) return page;
    changed = true;
    return { ...page, messages };
  });

  return changed ? { ...data, pages } : data;
};

export function UserEvents() {
  const { addListener } = useWebSocketContext();
  const queryClient = useQueryClient();

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type !== 'USER_UPDATED') return;

        const user = (frame.data as { user?: UserRef } | undefined)?.user;
        if (!user || typeof user.id !== 'string') return;

        queryClient.setQueryData<CurrentUser>(['user'], (current) =>
          current?.id === user.id ? { ...current, username: user.username, displayName: user.displayName, avatarVersion: user.avatarVersion } : current,
        );
        queryClient.setQueriesData<InfiniteData<MessagesPage>>({ queryKey: ['messages'] }, (data) => patchMessageSenders(data, user));
        void queryClient.invalidateQueries({ queryKey: ['friends'] });
        void queryClient.invalidateQueries({ queryKey: ['profile', user.id] });
      }),
    [addListener, queryClient],
  );

  return null;
}
