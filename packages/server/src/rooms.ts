/** Battle rooms: matchmaking queue, private rooms, solo AI battles, turn timers and rewards. */
import type { Server, Socket } from 'socket.io';
import type { DatabaseSync } from 'node:sqlite';
import {
  applyAction, BattleError, createBattle, playAiTurn, obtainableVivosaurs, memberAtRank, rankFromPoints,
  PRIZE_DRAW, PRIZE_LOSS, PRIZE_SOLO_LOSS, PRIZE_SOLO_WIN, PRIZE_WIN, RANK_POINTS_LOSS, RANK_POINTS_SOLO, RANK_POINTS_WIN,
  type BattleAction, type BattleState, type TeamSetup,
} from '@ffo/shared';
import type { UserRow } from './db.js';
import { awardBattle, teamMembers } from './game.js';

const TURN_SECONDS = 75;
const DISCONNECT_GRACE_MS = 60_000;

interface Participant {
  userId: number | null; // null = AI
  username: string;
  socketId: string | null;
  vivosaurIds: number[];
  disconnectTimer?: NodeJS.Timeout;
}

interface Room {
  id: string;
  kind: 'ranked' | 'private' | 'solo';
  state: BattleState;
  sides: [Participant, Participant];
  turnTimer?: NodeJS.Timeout;
  turnDeadline: number;
  finished: boolean;
}

export interface SocketData {
  user: UserRow;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<string, string>(); // socketId -> roomId
  private byUser = new Map<number, string>(); // userId -> roomId
  private queue: { socket: Socket; user: UserRow }[] = [];
  private privateRooms = new Map<string, { socket: Socket; user: UserRow }>();

  constructor(private io: Server, private db: DatabaseSync) {}

  attach(socket: Socket) {
    const user = (socket.data as SocketData).user;
    // Reconnect to an ongoing battle.
    const existingRoomId = this.byUser.get(user.id);
    if (existingRoomId) {
      const room = this.rooms.get(existingRoomId);
      if (room && !room.finished) {
        const sideIdx = room.sides.findIndex((p) => p.userId === user.id) as 0 | 1;
        const p = room.sides[sideIdx];
        p.socketId = socket.id;
        if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
        p.disconnectTimer = undefined;
        this.bySocket.set(socket.id, room.id);
        socket.join(room.id);
        socket.emit('battle:start', this.startPayload(room, sideIdx));
      }
    }

    socket.on('queue:join', () => this.joinQueue(socket, user));
    socket.on('queue:leave', () => this.leaveQueue(socket));
    socket.on('room:create', () => this.createPrivate(socket, user));
    socket.on('room:join', (code: string) => this.joinPrivate(socket, user, String(code ?? '').toUpperCase().trim()));
    socket.on('solo:start', () => this.startSolo(socket, user));
    socket.on('battle:action', (action: BattleAction) => this.handleAction(socket, action));
    socket.on('battle:leave', () => this.handleAction(socket, { type: 'forfeit' }));
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  private freshUser(id: number): UserRow {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
  }

  private loadTeam(user: UserRow): { setup: TeamSetup; ids: number[] } | null {
    const fresh = this.freshUser(user.id);
    const { ids, members } = teamMembers(this.db, fresh);
    if (members.length === 0) return null;
    return { setup: { id: String(fresh.id), name: fresh.username, members, heroLevel: 20 }, ids };
  }

  private joinQueue(socket: Socket, user: UserRow) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    if (this.queue.some((q) => q.user.id === user.id)) return;
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    if (team.setup.members.length < 3) return socket.emit('error', { message: 'Ranked battles need a full team of three vivosaurs' });
    this.queue.push({ socket, user });
    socket.emit('queue:status', { queued: true, size: this.queue.length });
    if (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      this.startBattle('ranked', [a, b]);
    }
  }

  private leaveQueue(socket: Socket) {
    this.queue = this.queue.filter((q) => q.socket.id !== socket.id);
    for (const [code, entry] of this.privateRooms) if (entry.socket.id === socket.id) this.privateRooms.delete(code);
    socket.emit('queue:status', { queued: false, size: this.queue.length });
  }

  private createPrivate(socket: Socket, user: UserRow) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    let code = '';
    do code = Math.random().toString(36).slice(2, 7).toUpperCase(); while (this.privateRooms.has(code));
    this.privateRooms.set(code, { socket, user });
    socket.emit('room:created', { code });
  }

  private joinPrivate(socket: Socket, user: UserRow, code: string) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    const host = this.privateRooms.get(code);
    if (!host) return socket.emit('error', { message: 'No room with that code' });
    if (host.user.id === user.id) return socket.emit('error', { message: 'You cannot battle yourself' });
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    this.privateRooms.delete(code);
    this.startBattle('private', [host, { socket, user }]);
  }

  private startSolo(socket: Socket, user: UserRow) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    this.leaveQueue(socket);
    const avgRank = Math.round(team.setup.members.reduce((a, m) => a + m.rank, 0) / team.setup.members.length);
    const pool = obtainableVivosaurs();
    const picks: string[] = [];
    while (picks.length < 3) {
      const v = pool[Math.floor(Math.random() * pool.length)];
      if (!picks.includes(v.id)) picks.push(v.id);
    }
    const aiTeam: TeamSetup = { id: 'ai', name: 'Fossil Fighter Bot', members: picks.map((id) => memberAtRank(id, Math.max(1, Math.min(20, avgRank)))), heroLevel: 20 };
    const seed = Math.floor(Math.random() * 2 ** 31);
    const state = createBattle([team.setup, aiTeam], seed);
    const room: Room = {
      id: `solo-${seed}-${user.id}`,
      kind: 'solo',
      state,
      sides: [
        { userId: user.id, username: user.username, socketId: socket.id, vivosaurIds: team.ids },
        { userId: null, username: aiTeam.name, socketId: null, vivosaurIds: [] },
      ],
      turnDeadline: 0,
      finished: false,
    };
    this.register(room);
    socket.emit('battle:start', this.startPayload(room, 0));
    this.afterStateChange(room);
  }

  private startBattle(kind: 'ranked' | 'private', players: [{ socket: Socket; user: UserRow }, { socket: Socket; user: UserRow }]) {
    const teams = players.map((p) => this.loadTeam(p.user));
    if (!teams[0] || !teams[1]) {
      for (const p of players) p.socket.emit('error', { message: 'A player has no team' });
      return;
    }
    const seed = Math.floor(Math.random() * 2 ** 31);
    const state = createBattle([teams[0].setup, teams[1].setup], seed);
    const room: Room = {
      id: `${kind}-${seed}-${players[0].user.id}-${players[1].user.id}`,
      kind,
      state,
      sides: [
        { userId: players[0].user.id, username: players[0].user.username, socketId: players[0].socket.id, vivosaurIds: teams[0].ids },
        { userId: players[1].user.id, username: players[1].user.username, socketId: players[1].socket.id, vivosaurIds: teams[1].ids },
      ],
      turnDeadline: 0,
      finished: false,
    };
    this.register(room);
    players[0].socket.emit('queue:status', { queued: false, size: this.queue.length });
    players[1].socket.emit('queue:status', { queued: false, size: this.queue.length });
    players[0].socket.emit('battle:start', this.startPayload(room, 0));
    players[1].socket.emit('battle:start', this.startPayload(room, 1));
    this.afterStateChange(room);
  }

  private register(room: Room) {
    this.rooms.set(room.id, room);
    for (const p of room.sides) {
      if (p.userId !== null) this.byUser.set(p.userId, room.id);
      if (p.socketId) {
        this.bySocket.set(p.socketId, room.id);
        this.io.sockets.sockets.get(p.socketId)?.join(room.id);
      }
    }
  }

  private startPayload(room: Room, side: 0 | 1) {
    return { roomId: room.id, kind: room.kind, side, state: room.state, players: room.sides.map((p) => p.username), turnDeadline: room.turnDeadline, turnSeconds: TURN_SECONDS };
  }

  private handleAction(socket: Socket, action: BattleAction) {
    const roomId = this.bySocket.get(socket.id);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room || room.finished) return socket.emit('error', { message: 'You are not in a battle' });
    const side = room.sides.findIndex((p) => p.socketId === socket.id) as 0 | 1;
    if (side < 0) return;
    const before = room.state.log.length;
    try {
      applyAction(room.state, side, action);
    } catch (e) {
      const msg = e instanceof BattleError ? e.message : 'Illegal action';
      return socket.emit('battle:rejected', { message: msg });
    }
    this.broadcast(room, before);
    this.afterStateChange(room);
  }

  private broadcast(room: Room, fromIndex: number) {
    const events = room.state.log.slice(fromIndex);
    this.io.to(room.id).emit('battle:update', { state: room.state, events, turnDeadline: room.turnDeadline });
  }

  /** Runs AI turns, resets the turn timer, and settles finished battles. */
  private afterStateChange(room: Room) {
    if (room.finished) return;
    if (room.state.phase === 'finished') return this.finish(room);
    const active = room.sides[room.state.active];
    if (active.userId === null) {
      // AI acts after a short delay so the client can animate.
      if (room.turnTimer) clearTimeout(room.turnTimer);
      room.turnTimer = setTimeout(() => {
        const before = room.state.log.length;
        playAiTurn(room.state, room.state.active);
        this.broadcast(room, before);
        this.afterStateChange(room);
      }, 1200);
      return;
    }
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    this.io.to(room.id).emit('battle:timer', { turnDeadline: room.turnDeadline, side: room.state.active });
    room.turnTimer = setTimeout(() => {
      if (room.finished || room.state.phase !== 'active') return;
      const before = room.state.log.length;
      try {
        applyAction(room.state, room.state.active, { type: 'endTurn' });
      } catch {
        /* ignore */
      }
      this.broadcast(room, before);
      this.afterStateChange(room);
    }, TURN_SECONDS * 1000);
  }

  private finish(room: Room) {
    room.finished = true;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const winner = room.state.winner;
    const rewards = room.sides.map((p, i) => {
      if (p.userId === null) return null;
      const won = winner === null ? null : winner === i;
      let gold: number, points: number;
      if (room.kind === 'solo') {
        gold = won ? PRIZE_SOLO_WIN : PRIZE_SOLO_LOSS;
        points = RANK_POINTS_SOLO;
      } else {
        gold = won === null ? PRIZE_DRAW : won ? PRIZE_WIN : PRIZE_LOSS;
        points = won ? RANK_POINTS_WIN : RANK_POINTS_LOSS;
      }
      awardBattle(this.db, p.userId, p.vivosaurIds, gold, points, room.kind === 'solo' ? null : won);
      return { gold, rankPoints: points, won };
    });
    this.db.prepare('INSERT INTO matches (kind, p1_user, p2_user, p1_name, p2_name, winner, seed, turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      room.kind, room.sides[0].userId, room.sides[1].userId, room.sides[0].username, room.sides[1].username, winner, room.state.seed, room.state.turn,
    );
    for (let i = 0; i < 2; i++) {
      const p = room.sides[i];
      if (p.socketId) {
        const s = this.io.sockets.sockets.get(p.socketId);
        s?.emit('battle:end', { winner, reason: room.state.endReason, reward: rewards[i], state: room.state });
        s?.leave(room.id);
        this.bySocket.delete(p.socketId);
      }
      if (p.userId !== null) this.byUser.delete(p.userId);
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.id);
  }

  private onDisconnect(socket: Socket) {
    this.leaveQueue(socket);
    const roomId = this.bySocket.get(socket.id);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    this.bySocket.delete(socket.id);
    if (!room || room.finished) return;
    const side = room.sides.findIndex((p) => p.socketId === socket.id) as 0 | 1;
    if (side < 0) return;
    const p = room.sides[side];
    p.socketId = null;
    this.io.to(room.id).emit('battle:opponentDisconnected', { side, graceSeconds: DISCONNECT_GRACE_MS / 1000 });
    p.disconnectTimer = setTimeout(() => {
      if (room.finished || p.socketId) return;
      try {
        applyAction(room.state, side, { type: 'forfeit' });
      } catch {
        /* already over */
      }
      this.broadcast(room, Math.max(0, room.state.log.length - 2));
      this.afterStateChange(room);
    }, DISCONNECT_GRACE_MS);
  }
}
