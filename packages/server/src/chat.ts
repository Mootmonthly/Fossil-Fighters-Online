/** Server-wide chat over Socket.IO: history on connect, rate limit, admin delete and mute. */
import type { Server, Socket } from 'socket.io';
import type { DatabaseSync } from 'node:sqlite';
import { CHAT_COOLDOWN_MS, CHAT_HISTORY, CHAT_MAX_LENGTH } from '@ffo/shared';
import type { UserRow } from './db.js';
import type { SocketData } from './rooms.js';

export interface ChatMessage {
  id: number;
  username: string;
  text: string;
  at: string;
}

const lastSent = new Map<number, number>();

function history(db: DatabaseSync): ChatMessage[] {
  const rows = db.prepare('SELECT id, username, text, created_at FROM chat_messages ORDER BY id DESC LIMIT ?').all(CHAT_HISTORY) as { id: number; username: string; text: string; created_at: string }[];
  return rows.reverse().map((r) => ({ id: r.id, username: r.username, text: r.text, at: r.created_at.replace(' ', 'T') + 'Z' }));
}

function online(io: Server): number {
  const ids = new Set<number>();
  for (const s of io.sockets.sockets.values()) ids.add((s.data as SocketData).user.id);
  return ids.size;
}

export function attachChat(io: Server, db: DatabaseSync, socket: Socket, isAdmin: (u: UserRow) => boolean) {
  socket.join('chat');
  socket.emit('chat:history', { messages: history(db) });
  io.to('chat').emit('chat:online', { count: online(io) });
  socket.on('disconnect', () => io.to('chat').emit('chat:online', { count: online(io) }));

  socket.on('chat:send', (payload: { text?: unknown }) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get((socket.data as SocketData).user.id) as unknown as UserRow | undefined;
    if (!user) return;
    if (user.muted) return socket.emit('chat:error', { message: 'You are muted in chat.' });
    const text = String(payload?.text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const now = Date.now();
    if (now - (lastSent.get(user.id) ?? 0) < CHAT_COOLDOWN_MS) return socket.emit('chat:error', { message: 'Slow down a little.' });
    lastSent.set(user.id, now);
    const info = db.prepare('INSERT INTO chat_messages (user_id, username, text) VALUES (?, ?, ?)').run(user.id, user.username, text);
    const msg: ChatMessage = { id: Number(info.lastInsertRowid), username: user.username, text, at: new Date().toISOString() };
    io.to('chat').emit('chat:message', msg);
    // keep the table small
    db.prepare('DELETE FROM chat_messages WHERE id < ?').run(msg.id - 2000);
  });

  socket.on('chat:delete', (payload: { id?: unknown }) => {
    const user = (socket.data as SocketData).user;
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
    if (!fresh || !isAdmin(fresh)) return;
    const id = Number(payload?.id);
    db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
    io.to('chat').emit('chat:deleted', { id });
  });
}

export const chatAdmin = {
  setMuted(db: DatabaseSync, userId: number, muted: boolean) {
    db.prepare('UPDATE users SET muted = ? WHERE id = ?').run(muted ? 1 : 0, userId);
  },
};
