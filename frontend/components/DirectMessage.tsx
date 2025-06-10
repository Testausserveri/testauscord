'use client';

import type React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFriends, getMessages } from '@/api/api';
import { Friend, Message } from '@/types/types';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { notFound } from 'next/navigation';
import Loader from './Loader';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Send } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useWebSocketContext } from '@/contexts/WebSocketContext';

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

export function DirectMessage({ id }: { id: string }) {
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
    staleTime: 1000 * 20,
  });

  const { data: messages, isPending: messagesPending } = useQuery({
    queryKey: ['messages', id],
    queryFn: () => getMessages(id),
    staleTime: 1000 * 20,
    refetchOnMount: 'always',
  });

  const { sendMessage, lastMessage, readyState } = useWebSocketContext();

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

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

  useEffect(() => {
    if (readyState === WebSocket.OPEN) {
      sendMessage(
        JSON.stringify({
          type: 'SUBSCRIBE',
          data: {
            channelId: id,
          },
        })
      );
    }

    return () => {
      if (readyState === WebSocket.OPEN) {
        sendMessage(
          JSON.stringify({
            type: 'UNSUBSCRIBE',
            data: {
              channelId: id,
            },
          })
        );
      }
    };
  }, [id, readyState, sendMessage]);

  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
      setIsUserScrolledUp(false);
    }, 100);
  }, []);

  useEffect(() => {
    if (lastMessage !== null) {
      try {
        const data = JSON.parse(lastMessage.data);

        if (data.type === 'MESSAGE_CREATE' && data.data) {
          const newMessage: Message = data.data;

          if (newMessage.channelId !== id) return;

          queryClient.setQueryData(['messages', id], (oldMessages: Message[] | undefined) => {
            if (!oldMessages) return [newMessage];

            const messageExists = oldMessages.some((msg) => msg.id === newMessage.id);
            if (messageExists) return oldMessages;

            return [...oldMessages, newMessage];
          });

          setTimeout(() => {
            if (!isUserScrolledUp) {
              scrollToBottom();
            }
          }, 50);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    }
  }, [lastMessage, id, queryClient, isUserScrolledUp]);

  const friend = data?.find((f: Friend) => f.id === id)?.friend;

  if (!friend) return notFound();

  const handleSendMessage = async () => {
    if (!messageInput.trim() || isSending || readyState !== WebSocket.OPEN) return;

    setIsSending(true);
    try {
      sendMessage(
        JSON.stringify({
          type: 'MESSAGE_SEND',
          data: {
            channelId: id,
            content: messageInput.trim(),
          },
        })
      );

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
      <header className="px-4 py-3 border-b flex items-center">
        <div className="flex items-center gap-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={''} alt={friend.username} />
            <AvatarFallback className="bg-[#2b2d31]">
              {friend.username.charAt(0)}
              {friend.username.split(' ')[1]?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <h1 className="font-semibold">{friend.username}</h1>
        </div>
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-auto" onScroll={handleScroll}>
        {messagesPending ? (
          <div className="flex items-center justify-center h-full">
            <Loader />
          </div>
        ) : (
          <div className="p-4 space-y-1">
            {messages?.map((message: Message, index: number) => {
              const prevMessage = index > 0 ? messages[index - 1] : undefined;
              const isGrouped = shouldGroupMessages(message, prevMessage);

              return (
                <div key={message.id} className={`group hover:bg-muted/50 ${isGrouped ? 'px-1' : 'px-2'} py-1 rounded transition-colors ${isGrouped ? 'mt-0.5' : 'mt-4'}`}>
                  {!isGrouped ? (
                    <div className="flex gap-4">
                      <Avatar className="h-10 w-10 mt-0.5 flex-shrink-0">
                        <AvatarImage src={''} alt={message.sender.username} />
                        <AvatarFallback className="bg-[#2b2d31]">
                          {message.sender.username.charAt(0)}
                          {message.sender.username.split(' ')[1]?.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium hover:underline cursor-pointer">{message.sender.username}</span>
                          <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">{formatTimestamp(message.createdAt)}</span>
                        </div>
                        <div className="text-foreground leading-[1.375] break-words">{message.content}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <div className="w-14 flex-shrink-0 flex justify-center">
                        <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity leading-[1.375] mt-0.5">{formatTimestamp(message.createdAt)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-foreground leading-[1.375] break-words">{message.content}</div>
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
              placeholder={`Message ${friend.username}...`}
              disabled={isSending}
              className="resize-none min-h-[44px] max-h-32"
            />
          </div>
          <Button onClick={handleSendMessage} size="icon" disabled={!messageInput.trim() || isSending} className="h-11 w-11 flex-shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
