/** Admin panel queries: account lookup, grants, and per-vivosaur usage and win rates. */
import type { DatabaseSync } from 'node:sqlite';
import { findVivosaur, obtainableVivosaurs, PARTS, VIVOSAURS, type Element, type FossilPart } from '@ffo/shared';
import type { FossilRow, UserRow, VivosaurRow } from './db.js';
import { GameError, grantRock, listFossils, listVivosaurs, publicUser, viewVivosaur } from './game.js';

const ADMIN_USERS = (process.env.ADMIN_USERS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Admins are named in ADMIN_USERS (comma-separated usernames), flagged in the database, or, when the variable is unset, the first account. */
export function isAdmin(user: UserRow): boolean {
  if (user.is_admin) return true;
  if (ADMIN_USERS.length > 0) return ADMIN_USERS.includes(user.username.toLowerCase());
  return user.id === 1;
}

export function adminListUsers(db: DatabaseSync, query: string) {
  const q = `%${query.trim()}%`;
  const rows = db.prepare(`
    SELECT u.id, u.username, u.gold, u.wins, u.losses, u.elo, u.created_at, u.is_admin,
      (SELECT COUNT(*) FROM vivosaurs v WHERE v.user_id = u.id) AS vivosaurs,
      (SELECT COUNT(*) FROM fossils f WHERE f.user_id = u.id AND f.state = 'rock') AS rocks
    FROM users u WHERE u.username LIKE ? ORDER BY u.id DESC LIMIT 100`).all(q) as Record<string, unknown>[];
  return rows;
}

/** Everything about one account. Fossils are shown with their hidden species, since the admin is not playing. */
export function adminUserDetail(db: DatabaseSync, userId: number) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow | undefined;
  if (!user) throw new GameError('No such user', 404);
  const vivosaurs = listVivosaurs(db, userId).map((row: VivosaurRow) => viewVivosaur(row));
  const fossils = listFossils(db, userId).map((f: FossilRow) => ({
    id: f.id, kind: f.kind, element: f.element, speciesId: f.species_id, speciesName: f.species_id ? findVivosaur(f.species_id)?.name ?? f.species_id : null,
    part: f.part, redBoned: !!f.red_boned, state: f.state, score: f.score, known: !!f.known, createdAt: f.created_at,
  }));
  const matches = db.prepare('SELECT * FROM matches WHERE p1_user = ? OR p2_user = ? ORDER BY id DESC LIMIT 30').all(userId, userId);
  return { user: { ...publicUser(user, isAdmin(user)), createdAt: user.created_at, muted: !!user.muted }, vivosaurs, fossils, matches };
}

export function adminGrantGold(db: DatabaseSync, userId: number, amount: number) {
  if (!Number.isInteger(amount) || Math.abs(amount) > 10_000_000) throw new GameError('Amount must be a whole number up to 10,000,000');
  const info = db.prepare('UPDATE users SET gold = MAX(0, gold + ?) WHERE id = ?').run(amount, userId);
  if (info.changes === 0) throw new GameError('No such user', 404);
  return db.prepare('SELECT gold FROM users WHERE id = ?').get(userId) as { gold: number };
}

export function adminGrantRock(db: DatabaseSync, userId: number, body: { kind?: string; element?: string | null; speciesId?: string | null; part?: string | null; known?: boolean }) {
  const kind = body.kind ?? 'normal';
  if (!['normal', 'dark', 'wondrous', 'miraculous'].includes(kind)) throw new GameError('Rock kind must be normal, dark, wondrous or miraculous');
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!exists) throw new GameError('No such user', 404);
  let speciesId: string | undefined;
  if (body.speciesId) {
    const sp = findVivosaur(body.speciesId);
    if (!sp) throw new GameError('Unknown vivosaur');
    if (!obtainableVivosaurs().some((v) => v.id === sp.id)) throw new GameError(`${sp.name} cannot be found in fossil rocks`);
    speciesId = sp.id;
  }
  let part: FossilPart | undefined;
  if (body.part) {
    if (!PARTS.includes(body.part as FossilPart)) throw new GameError('Part must be head, body, arms or legs');
    part = body.part as FossilPart;
  }
  const element = body.element && body.element !== 'any' ? (body.element as Element) : null;
  if (kind === 'wondrous' || kind === 'miraculous') speciesId = undefined;
  return grantRock(db, userId, kind, speciesId ? null : element, { speciesId, part: kind === 'dark' ? 'head' : part, known: !!body.known || !!speciesId });
}

/** Per-vivosaur picks, wins and losses across recorded battles (both sides of every match). */
export function adminStats(db: DatabaseSync, includeSolo: boolean) {
  const where = includeSolo ? "user_id IS NOT NULL" : "user_id IS NOT NULL AND kind != 'solo'";
  const rows = db.prepare(`
    SELECT species_id, COUNT(*) AS picks, SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS wins, SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) AS losses
    FROM match_vivosaurs WHERE ${where} GROUP BY species_id`).all() as { species_id: string; picks: number; wins: number; losses: number }[];
  const sides = (db.prepare(`SELECT COUNT(DISTINCT match_id || '-' || side) AS n FROM match_vivosaurs WHERE ${where}`).get() as { n: number }).n;
  const totals = db.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM matches) AS matches, (SELECT COUNT(*) FROM matches WHERE kind != \'solo\') AS pvpMatches').get();
  const byId = new Map(rows.map((r) => [r.species_id, r]));
  const vivosaurs = VIVOSAURS.map((v) => {
    const r = byId.get(v.id);
    const picks = r?.picks ?? 0, wins = r?.wins ?? 0, losses = r?.losses ?? 0;
    return {
      speciesId: v.id, name: v.name, num: v.num, element: v.element, picks, wins, losses,
      usageRate: sides ? picks / sides : 0,
      winRate: wins + losses ? wins / (wins + losses) : null,
    };
  }).filter((v) => v.picks > 0 || obtainableVivosaurs().some((o) => o.id === v.speciesId));
  return { teamsRecorded: sides, totals, vivosaurs };
}
