'use client';

import type React from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { getMessages, createMessage } from '@/api/api';
import { Message } from '@/types/types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Send } from 'lucide-react';
import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { useProfilePopover } from './ProfilePopoverProvider';
import { UserAvatar } from './UserAvatar';
import Loader from './Loader';

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

  if (diffInHours < 24) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffInHours < 168) {
    return date.toLocaleDateString([], { weekday: 'short' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString();
  }
};

const shouldGroupMessages = (currentMsg: Message, prevMsg: Message | undefined) => {
  if (!prevMsg) return false;

  const timeDiff = new Date(currentMsg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  return prevMsg.sender.id === currentMsg.sender.id && timeDiff < fiveMinutes;
};

type MessagesPage = {
  messages: Message[];
  nextCursor: string | null;
};

type ChannelChatProps = {
  channelId: string;
  header: ReactNode;
  placeholder: string;
};

export function ChannelChat({ channelId, header, placeholder }: ChannelChatProps) {
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { openProfile } = useProfilePopover();

  const {
    data: messagesData,
    isPending: messagesPending,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['messages', channelId],
    queryFn: ({ pageParam }) => getMessages(channelId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MessagesPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 20,
    refetchOnMount: 'always',
  });

  // pages arrive newest first; show them oldest first
  const messages = messagesData ? [...messagesData.pages].reverse().flatMap((page) => page.messages) : undefined;

  const appendMessage = useCallback(
    (message: Message) => {
      queryClient.setQueryData<InfiniteData<MessagesPage>>(['messages', channelId], (oldData) => {
        if (!oldData?.pages[0]) return oldData;
        if (oldData.pages[0].messages.some((existing) => existing.id === message.id)) return oldData;

        return {
          ...oldData,
          pages: [{ ...oldData.pages[0], messages: [...oldData.pages[0].messages, message] }, ...oldData.pages.slice(1)],
        };
      });
    },
    [channelId, queryClient],
  );

  const { subscribeToChannel, addListener } = useWebSocketContext();

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, []);

  const isNearBottom = () => {
    if (!scrollContainerRef.current) return false;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    return scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const nearBottom = isNearBottom();

    if (nearBottom && isUserScrolledUp) {
      setIsUserScrolledUp(false);
    } else if (!nearBottom && !isUserScrolledUp) {
      setIsUserScrolledUp(true);
    }
  };

  const loadOlderMessages = async () => {
    const container = scrollContainerRef.current;
    const previousHeight = container?.scrollHeight ?? 0;

    await fetchNextPage();

    requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - previousHeight;
    });
  };

  useEffect(() => subscribeToChannel(channelId), [channelId, subscribeToChannel]);

  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
      setIsUserScrolledUp(false);
    }, 100);
  }, [scrollToBottom]);

  useEffect(
    () =>
      addListener((frame) => {
        if (frame.type !== 'MESSAGE_CREATE') return;

        const newMessage = (frame.data as { message?: Message } | undefined)?.message;
        if (!newMessage || newMessage.channelId !== channelId) return;

        appendMessage(newMessage);

        setTimeout(() => {
          if (!isUserScrolledUp) {
            scrollToBottom();
          }
        }, 50);
      }),
    [addListener, channelId, appendMessage, scrollToBottom, isUserScrolledUp],
  );

  const handleSendMessage = async () => {
    const content = messageInput.trim();
    if (!content || isSending) return;

    setIsSending(true);
    try {
      const newMessage = (await createMessage(channelId, content, crypto.randomUUID())) as Message;

      appendMessage(newMessage);

      setMessageInput('');
      setIsUserScrolledUp(false);
      setTimeout(() => {
        scrollToBottom();
      }, 50);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 py-3 border-b flex items-center">{header}</header>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        {messagesPending ? (
          <div className="flex items-center justify-center h-full">
            <Loader />
          </div>
        ) : (
          <div className="p-4 space-y-1">
            {hasNextPage && (
              <div className="flex justify-center pb-2">
                <Button variant="ghost" size="sm" onClick={loadOlderMessages} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? 'Loading...' : 'Load older messages'}
                </Button>
              </div>
            )}
            {messages?.map((message: Message, index: number) => {
              const prevMessage = index > 0 ? messages[index - 1] : undefined;
              const isGrouped = shouldGroupMessages(message, prevMessage);

              return (
                <div key={message.id} className={`group hover:bg-muted/50 ${isGrouped ? 'px-1' : 'px-2'} py-1 rounded transition-colors ${isGrouped ? 'mt-0.5' : 'mt-4'}`}>
                  {!isGrouped ? (
                    <div className="flex gap-4">
                      <button type="button" onClick={(event) => openProfile(message.sender.id, event.currentTarget)} aria-label="View profile" className="shrink-0">
                        <UserAvatar user={message.sender} className="h-10 w-10 mt-0.5" />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <button type="button" onClick={(event) => openProfile(message.sender.id, event.currentTarget)} className="font-medium hover:underline cursor-pointer">
                            {message.sender.displayName ?? message.sender.username}
                          </button>
                          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">{formatTimestamp(message.createdAt)}</span>
                        </div>
                        <div className="text-foreground leading-snug wrap-break-word">{message.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <div className="w-14 shrink-0 flex justify-center">
                        <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity leading-snug mt-0.5">{formatTimestamp(message.createdAt)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground leading-snug wrap-break-word">{message.content}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t bg-background p-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Input
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyUp={handleKeyPress}
              placeholder={placeholder}
              disabled={isSending}
              className="resize-none min-h-11 max-h-32"
            />
          </div>
          <Button onClick={handleSendMessage} size="icon" disabled={!messageInput.trim() || isSending} className="h-11 w-11 shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
