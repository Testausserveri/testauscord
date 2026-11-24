import React, { createContext, useCallback, useContext, useEffect, useRef, ReactNode } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { logoutToLogin } from '@/lib/logout';

const getSocketUrl = async () => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const wsBase = (apiUrl || window.location.origin).replace(/^http/, 'ws');

  const response = await fetch(`${apiUrl}/realtime/ticket`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (response.status === 401) logoutToLogin('expired');
  if (!response.ok) throw new Error(`Ticket request failed with ${response.status}`);

  const data = (await response.json()) as { ticket?: string };
  if (!data.ticket) throw new Error('Ticket response missing ticket');

  return `${wsBase}/ws?v=1&ticket=${encodeURIComponent(data.ticket)}`;
};

export type RealtimeFrame = {
  type: string;
  data?: unknown;
  message?: string;
};

type FrameListener = (frame: RealtimeFrame) => void;

interface WebSocketContextType {
  subscribeToChannel: (channelId: string) => () => void;
  addListener: (listener: FrameListener) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const channelsRef = useRef(new Set<string>());
  const listenersRef = useRef(new Set<FrameListener>());
  const readyStateRef = useRef(ReadyState.UNINSTANTIATED);

  const { sendMessage, readyState } = useWebSocket(getSocketUrl, {
    onOpen: () => {
      readyStateRef.current = ReadyState.OPEN;

      for (const channelId of channelsRef.current) {
        sendMessage(JSON.stringify({ type: 'SUBSCRIBE', data: { channelId } }));
      }
    },
    onMessage: (event) => {
      let frame: RealtimeFrame;
      try {
        frame = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (frame?.type === 'SESSION_REVOKED') {
        logoutToLogin('revoked');
        return;
      }

      if (frame?.type === 'PING') {
        const nonce = (frame.data as { nonce?: unknown } | undefined)?.nonce;
        if (typeof nonce === 'string') {
          sendMessage(JSON.stringify({ type: 'PONG', data: { nonce } }));
          return;
        }
      }

      for (const listener of listenersRef.current) listener(frame);
    },
    onClose: (event) => {
      if (event.code === 4001) logoutToLogin('expired');
    },
    onError: (error) => {
      console.error('WebSocket error:', error);
    },
    shouldReconnect: () => true,
    retryOnError: true,
    reconnectAttempts: Infinity,
    reconnectInterval: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
  });

  useEffect(() => {
    readyStateRef.current = readyState;
  }, [readyState]);

  const subscribeToChannel = useCallback(
    (channelId: string) => {
      channelsRef.current.add(channelId);

      if (readyStateRef.current === ReadyState.OPEN) {
        sendMessage(JSON.stringify({ type: 'SUBSCRIBE', data: { channelId } }));
      }

      return () => {
        channelsRef.current.delete(channelId);

        if (readyStateRef.current === ReadyState.OPEN) {
          sendMessage(JSON.stringify({ type: 'UNSUBSCRIBE', data: { channelId } }));
        }
      };
    },
    [sendMessage],
  );

  const addListener = useCallback((listener: FrameListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  return <WebSocketContext.Provider value={{ subscribeToChannel, addListener }}>{children}</WebSocketContext.Provider>;
};

export const useWebSocketContext = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};
