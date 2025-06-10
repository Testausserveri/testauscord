import React, { createContext, useContext, ReactNode } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';

interface WebSocketContextType {
  sendMessage: (message: string) => void;
  lastMessage: MessageEvent | null;
  readyState: ReadyState;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  children: ReactNode;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children }) => {
  const { sendMessage, lastMessage, readyState } = useWebSocket(`${process.env.NEXT_PUBLIC_API_URL}/ws`, {
    onError: (error) => {
      console.error('WebSocket error:', error);
    },
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
    share: true,
  });

  return <WebSocketContext.Provider value={{ sendMessage, lastMessage, readyState }}>{children}</WebSocketContext.Provider>;
};

export const useWebSocketContext = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider');
  }
  return context;
};
