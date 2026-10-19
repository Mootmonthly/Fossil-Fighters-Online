/** Battle rooms: matchmaking queue, private rooms, solo AI battles, the pick phase, turn timers and rewards. */
import type { Server, Socket } from 'socket.io';
import type { DatabaseSync } from 'node:sqlite';
import {
  applyAction, BattleError, createBattle, playAiTurn, obtainableVivosaurs, memberAtRank, findVivosaur, isTeamCompatible,
  PRIZE_DRAW, PRIZE_LOSS, PRIZE_SOLO_LOSS, PRIZE_SOLO_WIN, PRIZE_WIN, RANK_POINTS_LOSS, RANK_POINTS_SOLO, RANK_POINTS_WIN,
  TEAM_SIZE, BATTLE_PICKS, PICK_SECONDS,
  type BattleAction, type BattleState, type TeamMember, type TeamSetup, type Formation,
} from '@ffo/shared';
import type { UserRow, VivosaurRow } from './db.js';
import { awardBattle, toOwned, viewVivosaur } from './game.js';
import { toTeamMember } from '@ffo/shared';

const TURN_SECONDS = 75;
const DISCONNECT_GRACE_MS = 60_000;

/** What both players see about a vivosaur during the pick phase. */
export interface PickView {
  id: number; // owner's vivosaur id (negative for the bot)
  speciesId: string;
  name: string;
  rank: number;
  element: string;
  range: string;
  stats: { lp: number; attack: number; defense: number; accuracy: number; speed: number };
}

interface Participant {
  userId: number | null; // null = AI
  username: string;
  socketId: string | null;
  /** The full battle team (up to TEAM_SIZE), in team order. */
  team: { ids: number[]; members: TeamMember[]; views: PickView[] };
  /** The BATTLE_PICKS vivosaurs chosen for this battle, in slot order, once picked. */
  chosen: { ids: number[]; members: TeamMember[]; formation: Formation } | null;
  disconnectTimer?: NodeJS.Timeout;
}

interface Room {
  id: string;
  kind: 'ranked' | 'private' | 'solo';
  phase: 'pick' | 'battle';
  state: BattleState | null;
  sides: [Participant, Participant];
  pickDeadline: number;
  pickTimer?: NodeJS.Timeout;
  turnTimer?: NodeJS.Timeout;
  turnDeadline: number;
  finished: boolean;
}

export interface SocketData {
  user: UserRow;
}

type Player = { socket: Socket; user: UserRow };

export class RoomManager {
  private rooms = new Map<string, Room>();
  private bySocket = new Map<string, string>(); // socketId -> roomId
  private byUser = new Map<number, string>(); // userId -> roomId
  private queue: Player[] = [];
  private privateRooms = new Map<string, Player>();

  constructor(private io: Server, private db: DatabaseSync) {}

  attach(socket: Socket) {
    const user = (socket.data as SocketData).user;
    // Reconnect to an ongoing pick phase or battle.
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
        if (room.phase === 'pick') {
          socket.emit('battle:pick', this.pickPayload(room, sideIdx));
          socket.emit('battle:pickStatus', { ready: room.sides.map((s) => !!s.chosen) });
        } else {
          socket.emit('battle:start', this.startPayload(room, sideIdx));
        }
      }
    }

    socket.on('queue:join', () => this.joinQueue(socket, user));
    socket.on('queue:leave', () => this.leaveQueue(socket));
    socket.on('room:create', () => this.createPrivate(socket, user));
    socket.on('room:join', (code: string) => this.joinPrivate(socket, user, String(code ?? '').toUpperCase().trim()));
    socket.on('solo:start', () => this.startSolo(socket, user));
    socket.on('battle:choose', (payload: { ids?: unknown; formation?: unknown }) => this.choose(socket, payload ?? {}));
    socket.on('battle:action', (action: BattleAction) => this.handleAction(socket, action));
    socket.on('battle:leave', () => this.handleAction(socket, { type: 'forfeit' }));
    socket.on('disconnect', () => this.onDisconnect(socket));
  }

  private freshUser(id: number): UserRow {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
  }

  private loadTeam(user: UserRow): Participant['team'] | null {
    const fresh = this.freshUser(user.id);
    const ids = (JSON.parse(fresh.team_json) as number[]).filter((id) => Number.isInteger(id)).slice(0, TEAM_SIZE);
    const team: Participant['team'] = { ids: [], members: [], views: [] };
    for (const id of ids) {
      const row = this.db.prepare('SELECT * FROM vivosaurs WHERE id = ? AND user_id = ?').get(id, user.id) as unknown as VivosaurRow | undefined;
      if (!row) continue;
      const view = viewVivosaur(row);
      const species = findVivosaur(view.displaySpeciesId)!;
      team.ids.push(id);
      team.members.push(toTeamMember(toOwned(row)));
      team.views.push({ id, speciesId: view.displaySpeciesId, name: view.nickname ?? species.name, rank: view.rank, element: species.element, range: species.range, stats: view.stats });
    }
    return team.ids.length ? team : null;
  }

  private joinQueue(socket: Socket, user: UserRow) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    if (this.queue.some((q) => q.user.id === user.id)) return;
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    if (team.ids.length < TEAM_SIZE) return socket.emit('error', { message: `Ranked battles need a full team of ${TEAM_SIZE} vivosaurs` });
    this.queue.push({ socket, user });
    socket.emit('queue:status', { queued: true, size: this.queue.length });
    if (this.queue.length >= 2) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      this.startPending('ranked', [a, b]);
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
    if (team.ids.length < TEAM_SIZE) return socket.emit('error', { message: `Private battles need a full team of ${TEAM_SIZE} vivosaurs` });
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
    if (team.ids.length < TEAM_SIZE) return socket.emit('error', { message: `Private battles need a full team of ${TEAM_SIZE} vivosaurs` });
    this.privateRooms.delete(code);
    this.startPending('private', [host, { socket, user }]);
  }

  private startSolo(socket: Socket, user: UserRow) {
    if (this.byUser.has(user.id)) return socket.emit('error', { message: 'You are already in a battle' });
    const team = this.loadTeam(user);
    if (!team) return socket.emit('error', { message: 'Set up a team first' });
    if (team.ids.length < BATTLE_PICKS) return socket.emit('error', { message: `Solo battles need at least ${BATTLE_PICKS} vivosaurs in your team` });
    this.leaveQueue(socket);
    // The bot brings a full team around the player's average rank and picks three at random.
    const avgRank = Math.max(1, Math.min(20, Math.round(team.members.reduce((a, m) => a + m.rank, 0) / team.members.length)));
    const pool = obtainableVivosaurs();
    const picks: string[] = [];
    while (picks.length < TEAM_SIZE) {
      const v = pool[Math.floor(Math.random() * pool.length)];
      if (!picks.includes(v.id)) picks.push(v.id);
    }
    const aiTeam: Participant['team'] = { ids: [], members: [], views: [] };
    picks.forEach((id, i) => {
      const m = memberAtRank(id, avgRank);
      const sp = findVivosaur(id)!;
      aiTeam.ids.push(-1 - i);
      aiTeam.members.push(m);
      aiTeam.views.push({ id: -1 - i, speciesId: id, name: sp.name, rank: m.rank, element: sp.element, range: sp.range, stats: m.stats });
    });
    const order = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5).slice(0, BATTLE_PICKS);
    const ai: Participant = {
      userId: null, username: 'Fossil Fighter Bot', socketId: null, team: aiTeam,
      chosen: { ids: order.map((i) => aiTeam.ids[i]), members: order.map((i) => aiTeam.members[i]), formation: Math.random() < 0.5 ? 'cambrian' : 'jurassic' },
    };
    this.openRoom('solo', [{ userId: user.id, username: user.username, socketId: socket.id, team, chosen: null }, ai]);
  }

  private startPending(kind: 'ranked' | 'private', players: [Player, Player]) {
    const teams = players.map((p) => this.loadTeam(p.user));
    if (!teams[0] || !teams[1]) {
      for (const p of players) p.socket.emit('error', { message: 'A player has no team' });
      return;
    }
    for (const p of players) p.socket.emit('queue:status', { queued: false, size: this.queue.length });
    this.openRoom(kind, [
      { userId: players[0].user.id, username: players[0].user.username, socketId: players[0].socket.id, team: teams[0], chosen: null },
      { userId: players[1].user.id, username: players[1].user.username, socketId: players[1].socket.id, team: teams[1], chosen: null },
    ]);
  }

  /** Creates the room in its pick phase: both players see each other's teams and choose three vivosaurs. */
  private openRoom(kind: Room['kind'], sides: [Participant, Participant]) {
    const room: Room = {
      id: `${kind}-${Date.now().toString(36)}-${sides[0].userId}-${sides[1].userId ?? 'ai'}`,
      kind,
      phase: 'pick',
      state: null,
      sides,
      pickDeadline: Date.now() + PICK_SECONDS * 1000,
      turnDeadline: 0,
      finished: false,
    };
    this.rooms.set(room.id, room);
    for (const p of room.sides) {
      if (p.userId !== null) this.byUser.set(p.userId, room.id);
      if (p.socketId) {
        this.bySocket.set(p.socketId, room.id);
        this.io.sockets.sockets.get(p.socketId)?.join(room.id);
      }
    }
    room.sides.forEach((p, i) => {
      if (p.socketId) this.io.sockets.sockets.get(p.socketId)?.emit('battle:pick', this.pickPayload(room, i as 0 | 1));
    });
    room.pickTimer = setTimeout(() => this.beginBattle(room), PICK_SECONDS * 1000);
  }

  private pickPayload(room: Room, side: 0 | 1) {
    return {
      roomId: room.id,
      kind: room.kind,
      side,
      pickDeadline: room.pickDeadline,
      pickSeconds: PICK_SECONDS,
      picks: BATTLE_PICKS,
      players: room.sides.map((p) => p.username),
      you: room.sides[side].team.views,
      opponent: room.sides[1 - side].team.views,
    };
  }

  private choose(socket: Socket, payload: { ids?: unknown; formation?: unknown }) {
    const roomId = this.bySocket.get(socket.id);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room || room.finished || room.phase !== 'pick') return socket.emit('error', { message: 'There is nothing to pick right now' });
    const side = room.sides.findIndex((p) => p.socketId === socket.id) as 0 | 1;
    if (side < 0) return;
    const p = room.sides[side];
    const ids = Array.isArray(payload.ids) ? payload.ids.map(Number) : [];
    const formation: Formation = payload.formation === 'jurassic' ? 'jurassic' : 'cambrian';
    const want = Math.min(BATTLE_PICKS, p.team.ids.length);
    if (ids.length !== want || new Set(ids).size !== ids.length || ids.some((id) => !p.team.ids.includes(id))) {
      return socket.emit('error', { message: `Pick ${want} different vivosaurs from your team` });
    }
    p.chosen = { ids, members: ids.map((id) => p.team.members[p.team.ids.indexOf(id)]), formation };
    this.io.to(room.id).emit('battle:pickStatus', { ready: room.sides.map((s) => !!s.chosen) });
    if (room.sides.every((s) => s.chosen)) this.beginBattle(room);
  }

  /** Locks in picks (auto-picking for anyone who did not choose) and starts the battle proper. */
  private beginBattle(room: Room) {
    if (room.finished || room.phase !== 'pick') return;
    if (room.pickTimer) clearTimeout(room.pickTimer);
    room.pickTimer = undefined;
    for (const p of room.sides) {
      if (!p.chosen) {
        const n = Math.min(BATTLE_PICKS, p.team.ids.length);
        p.chosen = { ids: p.team.ids.slice(0, n), members: p.team.members.slice(0, n), formation: 'cambrian' };
      }
    }
    const setups = room.sides.map((p) => ({ id: String(p.userId ?? 'ai'), name: p.username, members: p.chosen!.members, heroLevel: 20, formation: p.chosen!.formation } satisfies TeamSetup)) as [TeamSetup, TeamSetup];
    const seed = Math.floor(Math.random() * 2 ** 31);
    room.state = createBattle(setups, seed);
    room.phase = 'battle';
    room.sides.forEach((p, i) => {
      if (p.socketId) this.io.sockets.sockets.get(p.socketId)?.emit('battle:start', this.startPayload(room, i as 0 | 1));
      else if (p.userId !== null) this.startDisconnectTimer(room, i as 0 | 1);
    });
    this.afterStateChange(room);
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
    if (room.phase === 'pick' || !room.state) {
      // Leaving during the pick phase forfeits; nothing else is legal yet.
      if (action.type === 'forfeit') {
        this.beginBattle(room);
        if (room.state) {
          try {
            applyAction(room.state, side, { type: 'forfeit' });
          } catch {
            /* ignore */
          }
          this.broadcast(room, Math.max(0, room.state.log.length - 2));
          this.afterStateChange(room);
        }
      }
      return;
    }
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
    if (!room.state) return;
    const events = room.state.log.slice(fromIndex);
    this.io.to(room.id).emit('battle:update', { state: room.state, events, turnDeadline: room.turnDeadline });
  }

  /** Runs AI turns, resets the turn timer, and settles finished battles. */
  private afterStateChange(room: Room) {
    if (room.finished || !room.state) return;
    const state = room.state;
    if (state.phase === 'finished') return this.finish(room);
    const active = room.sides[state.active];
    if (active.userId === null) {
      // AI acts after a short delay so the client can animate.
      if (room.turnTimer) clearTimeout(room.turnTimer);
      room.turnTimer = setTimeout(() => {
        const before = state.log.length;
        playAiTurn(state, state.active);
        this.broadcast(room, before);
        this.afterStateChange(room);
      }, 1200);
      return;
    }
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    this.io.to(room.id).emit('battle:timer', { turnDeadline: room.turnDeadline, side: state.active });
    room.turnTimer = setTimeout(() => {
      if (room.finished || state.phase !== 'active') return;
      const before = state.log.length;
      try {
        applyAction(state, state.active, { type: 'endTurn' });
      } catch {
        /* ignore */
      }
      this.broadcast(room, before);
      this.afterStateChange(room);
    }, TURN_SECONDS * 1000);
  }

  private finish(room: Room) {
    const state = room.state!;
    room.finished = true;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const winner = state.winner;
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
      awardBattle(this.db, p.userId, p.chosen?.ids.filter((id) => id > 0) ?? [], gold, points, room.kind === 'solo' ? null : won);
      return { gold, rankPoints: points, won };
    });
    const info = this.db.prepare('INSERT INTO matches (kind, p1_user, p2_user, p1_name, p2_name, winner, seed, turns) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      room.kind, room.sides[0].userId, room.sides[1].userId, room.sides[0].username, room.sides[1].username, winner, state.seed, state.turn,
    );
    // Usage and win-rate statistics per vivosaur (the species that actually fought, in both teams).
    const matchId = Number(info.lastInsertRowid);
    const insert = this.db.prepare('INSERT INTO match_vivosaurs (match_id, user_id, side, species_id, won, kind) VALUES (?, ?, ?, ?, ?, ?)');
    room.sides.forEach((p, i) => {
      const won = winner === null ? null : winner === i ? 1 : 0;
      for (const m of p.chosen?.members ?? []) insert.run(matchId, p.userId, i, m.speciesId, won, room.kind);
    });
    for (let i = 0; i < 2; i++) {
      const p = room.sides[i];
      if (p.socketId) {
        const s = this.io.sockets.sockets.get(p.socketId);
        s?.emit('battle:end', { winner, reason: state.endReason, reward: rewards[i], state });
        s?.leave(room.id);
        this.bySocket.delete(p.socketId);
      }
      if (p.userId !== null) this.byUser.delete(p.userId);
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.id);
  }

  private startDisconnectTimer(room: Room, side: 0 | 1) {
    const p = room.sides[side];
    this.io.to(room.id).emit('battle:opponentDisconnected', { side, graceSeconds: DISCONNECT_GRACE_MS / 1000 });
    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    p.disconnectTimer = setTimeout(() => {
      if (room.finished || p.socketId) return;
      if (room.phase === 'pick') this.beginBattle(room);
      if (!room.state) return;
      try {
        applyAction(room.state, side, { type: 'forfeit' });
      } catch {
        /* already over */
      }
      this.broadcast(room, Math.max(0, room.state.log.length - 2));
      this.afterStateChange(room);
    }, DISCONNECT_GRACE_MS);
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
    room.sides[side].socketId = null;
    // During the pick phase the deadline auto-picks for them; the grace timer only matters once the battle runs.
    if (room.phase === 'battle') this.startDisconnectTimer(room, side);
  }
}

/** True when the three chosen species share a team-skill group (used by the client preview as well). */
export function picksCompatible(speciesIds: string[]): boolean {
  return speciesIds.length === BATTLE_PICKS && isTeamCompatible(speciesIds);
}
