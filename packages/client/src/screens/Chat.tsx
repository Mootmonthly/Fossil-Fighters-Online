import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { CHAT_MAX_LENGTH } from '@ffo/shared';
import type { ChatMessage } from '../chatStore.js';

export function ChatScreen({ socket, messages, online, me, isAdmin }: { socket: Socket | null; messages: ChatMessage[]; online: number; me: string; isAdmin: boolean }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !socket) return;
    socket.emit('chat:send', { text: t });
    setText('');
    stick.current = true;
  };
  return (
    <div className="panel chat">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Fossil Fighter Chat</h2>
        <span className="badge">{online} online</span>
      </div>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <div className="muted small">No messages yet. Say hello!</div>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.username === me ? 'mine' : ''}`}>
            <span className="chat-time">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <b className="chat-name">{m.username}</b>
            <span className="chat-text">{m.text}</span>
            {isAdmin && <button className="chat-del" title="Delete message" onClick={() => socket?.emit('chat:delete', { id: m.id })}>✕</button>}
          </div>
        ))}
      </div>
      <form className="row chat-form" onSubmit={send}>
        <input value={text} maxLength={CHAT_MAX_LENGTH} placeholder={socket ? 'Type a message…' : 'Connecting…'} onChange={(e) => setText(e.target.value)} disabled={!socket} />
        <button className="primary" type="submit" disabled={!socket || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
