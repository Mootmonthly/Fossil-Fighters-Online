import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';

export interface ChatMessage {
  id: number;
  username: string;
  text: string;
  at: string;
}

/** Keeps the chat history for the whole session (so the tab's unread count works while on other screens). */
export function useChat(socket: Socket | null, active: boolean, notify: (t: string, e?: boolean) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState(0);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!socket) return;
    const onHistory = (p: { messages: ChatMessage[] }) => setMessages(p.messages);
    const onMessage = (m: ChatMessage) => {
      setMessages((list) => [...list.slice(-199), m]);
      setUnread((n) => n + 1);
    };
    const onDeleted = (p: { id: number }) => setMessages((list) => list.filter((m) => m.id !== p.id));
    const onOnline = (p: { count: number }) => setOnline(p.count);
    const onError = (p: { message: string }) => notify(p.message, true);
    socket.on('chat:history', onHistory);
    socket.on('chat:message', onMessage);
    socket.on('chat:deleted', onDeleted);
    socket.on('chat:online', onOnline);
    socket.on('chat:error', onError);
    return () => {
      socket.off('chat:history', onHistory);
      socket.off('chat:message', onMessage);
      socket.off('chat:deleted', onDeleted);
      socket.off('chat:online', onOnline);
      socket.off('chat:error', onError);
    };
  }, [socket, notify]);
  useEffect(() => {
    if (active) setUnread(0);
  }, [active, messages]);
  return { messages, online, unread };
}
