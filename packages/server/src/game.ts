/** Account-side game logic: shop, cleaning, integration, teams, rewards. */
import type { DatabaseSync } from 'node:sqlite';
import {
  getVivosaur, obtainableVivosaurs, rankFromPoints, toTeamMember, computeStats, effectiveSpecies, MIN_CLEAN_SCORE, SHOP, PARTS, fossilImageSet,
  STARTER_CHOICES, STARTING_GOLD, type FossilPart, type OwnedVivosaur, type TeamMember, type Element,
} from '@ffo/shared';
import type { FossilRow, UserRow, VivosaurRow } from './db.js';

export class GameError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function toOwned(row: VivosaurRow): OwnedVivosaur {
  return {
    id: row.id,
    speciesId: row.species_id,
    nickname: row.nickname,
    rankPoints: row.rank_points,
    parts: { head: row.head, body: row.body, arms: row.arms, legs: row.legs },
    silver: row.silver_part ? { part: row.silver_part as FossilPart, score: row.silver_score ?? 0 } : null,
    gold: row.gold_score,
  };
}

export interface VivosaurView extends OwnedVivosaur {
  rank: number;
  displaySpeciesId: string;
  stats: ReturnType<typeof computeStats>;
}

export function viewVivosaur(row: VivosaurRow): VivosaurView {
  const owned = toOwned(row);
  return { ...owned, rank: rankFromPoints(owned.rankPoints), displaySpeciesId: effectiveSpecies(owned).id, stats: computeStats(owned) };
}

export function publicUser(u: UserRow) {
  return { id: u.id, username: u.username, gold: u.gold, heroLevel: u.hero_level, wins: u.wins, losses: u.losses, team: JSON.parse(u.team_json) as number[] };
}

export function listVivosaurs(db: DatabaseSync, userId: number): VivosaurRow[] {
  return db.prepare('SELECT * FROM vivosaurs WHERE user_id = ? ORDER BY id').all(userId) as unknown as VivosaurRow[];
}

export function listFossils(db: DatabaseSync, userId: number): FossilRow[] {
  return db.prepare('SELECT * FROM fossils WHERE user_id = ? ORDER BY id').all(userId) as unknown as FossilRow[];
}

/** What the client may see about a fossil: species stays hidden until the rock is cleaned. */
export function publicFossil(f: FossilRow) {
  const cleaned = f.state === 'cleaned';
  return {
    id: f.id,
    kind: f.kind,
    element: f.element,
    part: f.kind === 'normal' || f.kind === 'dark' ? f.part : f.kind === 'wondrous' ? f.part : null,
    redBoned: !!f.red_boned,
    state: f.state,
    score: f.score,
    speciesId: cleaned ? f.species_id : null,
    // the picture shown while cleaning reveals the fossil's shape, as in the game, but not the species name
    fossilImage: f.species_id && f.part ? fossilImageSet(f.species_id, f.part) : null,
    rockSeed: f.rock_seed,
  };
}

export function createStarterAccount(db: DatabaseSync, username: string, passHash: string, starter: string): UserRow {
  if (!STARTER_CHOICES.includes(starter)) throw new GameError('Pick a valid starter vivosaur');
  const info = db.prepare('INSERT INTO users (username, pass_hash, gold) VALUES (?, ?, ?)').run(username, passHash, STARTING_GOLD);
  const userId = Number(info.lastInsertRowid);
  // Starter arrives fully integrated at a modest rank, like the story's first Dino Medal.
  const starterPoints = 4 * 80;
  const v = db.prepare('INSERT INTO vivosaurs (user_id, species_id, rank_points, head, body, arms, legs) VALUES (?, ?, ?, 80, 80, 80, 80)').run(userId, starter, starterPoints);
  // Two tan rocks to get cleaning started.
  for (let i = 0; i < 2; i++) grantRock(db, userId, 'normal', null);
  db.prepare('UPDATE users SET team_json = ? WHERE id = ?').run(JSON.stringify([Number(v.lastInsertRowid)]), userId);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRow;
}

function randomInt(n: number): number {
  return Math.floor(Math.random() * n);
}

/** Creates a fossil rock for a user. Species/part are rolled now but hidden until cleaning. */
export function grantRock(db: DatabaseSync, userId: number, kind: string, element: Element | null): FossilRow {
  const seed = randomInt(2 ** 31);
  if (kind === 'wondrous') {
    const part = PARTS[randomInt(4)];
    const info = db.prepare('INSERT INTO fossils (user_id, kind, element, species_id, part, red_boned, rock_seed) VALUES (?, ?, NULL, NULL, ?, 0, ?)').run(userId, kind, part, seed);
    return db.prepare('SELECT * FROM fossils WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as FossilRow;
  }
  if (kind === 'miraculous') {
    const info = db.prepare('INSERT INTO fossils (user_id, kind, element, species_id, part, red_boned, rock_seed) VALUES (?, ?, NULL, NULL, NULL, 0, ?)').run(userId, kind, seed);
    return db.prepare('SELECT * FROM fossils WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as FossilRow;
  }
  const pool = obtainableVivosaurs().filter((v) => !element || v.element === element);
  const species = pool[randomInt(pool.length)];
  const part = kind === 'dark' ? 'head' : PARTS[randomInt(4)];
  const redBoned = kind === 'dark' ? 1 : Math.random() < 0.08 ? 1 : 0;
  const info = db.prepare('INSERT INTO fossils (user_id, kind, element, species_id, part, red_boned, rock_seed) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, kind, species.element, species.id, part, redBoned, seed);
  return db.prepare('SELECT * FROM fossils WHERE id = ?').get(Number(info.lastInsertRowid)) as unknown as FossilRow;
}

export function buyRock(db: DatabaseSync, user: UserRow, kind: string, element: string | null): { fossil: FossilRow; gold: number } {
  const offer = SHOP.find((o) => o.kind === kind && (o.element ?? null) === (element || null));
  if (!offer) throw new GameError('No such item in the shop');
  if (user.gold < offer.price) throw new GameError('Not enough G');
  const rocks = db.prepare("SELECT COUNT(*) AS n FROM fossils WHERE user_id = ? AND state = 'rock'").get(user.id) as { n: number };
  if (rocks.n >= 30) throw new GameError('Your fossil case is full (30 uncleaned rocks). Clean some first.');
  db.prepare('UPDATE users SET gold = gold - ? WHERE id = ?').run(offer.price, user.id);
  const fossil = grantRock(db, user.id, offer.kind, offer.element);
  return { fossil, gold: user.gold - offer.price };
}

export interface CleanResult {
  success: boolean;
  score: number;
  fossil: ReturnType<typeof publicFossil> | null;
  message: string;
  vivosaur?: VivosaurView;
  newSpecies?: boolean;
  pointsGained?: number;
}

/**
 * Records a cleaning result. Normal/dark fossils are integrated immediately (or stored until the head exists);
 * silver and gold fossils stay in the inventory until the player picks a vivosaur to integrate them into.
 */
export function cleanFossil(db: DatabaseSync, user: UserRow, fossilId: number, rawScore: number, durationMs: number): CleanResult {
  const f = db.prepare('SELECT * FROM fossils WHERE id = ? AND user_id = ?').get(fossilId, user.id) as unknown as FossilRow | undefined;
  if (!f) throw new GameError('No such fossil', 404);
  if (f.state !== 'rock') throw new GameError('That fossil is already cleaned');
  if (!Number.isFinite(rawScore)) throw new GameError('Bad score');
  if (durationMs < 3000) throw new GameError('Cleaning finished suspiciously fast');
  let score = Math.max(0, Math.min(100, Math.round(rawScore)));
  if (score < MIN_CLEAN_SCORE) {
    db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
    return { success: false, score, fossil: null, message: `Cleaning failed (${score} points). The fossil crumbled away.` };
  }
  if (f.red_boned) score += 25;

  if (f.kind === 'wondrous' || f.kind === 'miraculous') {
    db.prepare("UPDATE fossils SET state = 'cleaned', score = ? WHERE id = ?").run(Math.min(100, score), f.id);
    const row = db.prepare('SELECT * FROM fossils WHERE id = ?').get(f.id) as unknown as FossilRow;
    return { success: true, score, fossil: publicFossil(row), message: `${f.kind === 'wondrous' ? 'Silver' : 'Gold'} fossil cleaned at ${Math.min(100, score)} points! Choose a vivosaur to integrate it into.` };
  }

  const speciesId = f.species_id!;
  const part = f.part as FossilPart;
  const species = getVivosaur(speciesId);
  let vivo = db.prepare('SELECT * FROM vivosaurs WHERE user_id = ? AND species_id = ?').get(user.id, speciesId) as unknown as VivosaurRow | undefined;
  let newSpecies = false;
  let pointsGained = 0;
  if (!vivo) {
    if (part !== 'head') {
      // Keep the cleaned part until the head is found.
      db.prepare("UPDATE fossils SET state = 'cleaned', score = ? WHERE id = ?").run(score, f.id);
      const row = db.prepare('SELECT * FROM fossils WHERE id = ?').get(f.id) as unknown as FossilRow;
      return { success: true, score, fossil: publicFossil(row), message: `${species.name} ${part} cleaned at ${score} points. It will be integrated once you revive ${species.name} from its head fossil.` };
    }
    db.prepare('INSERT INTO vivosaurs (user_id, species_id, rank_points, head) VALUES (?, ?, ?, ?)').run(user.id, speciesId, score, score);
    vivo = db.prepare('SELECT * FROM vivosaurs WHERE user_id = ? AND species_id = ?').get(user.id, speciesId) as unknown as VivosaurRow;
    newSpecies = true;
    pointsGained = score;
    // Integrate any stored parts.
    const stored = db.prepare("SELECT * FROM fossils WHERE user_id = ? AND species_id = ? AND state = 'cleaned' AND kind IN ('normal','dark')").all(user.id, speciesId) as unknown as FossilRow[];
    for (const s of stored) {
      const p = s.part as FossilPart;
      const existing = vivo[p];
      if ((s.score ?? 0) > existing) {
        pointsGained += (s.score ?? 0) - existing;
        db.prepare(`UPDATE vivosaurs SET ${p} = ?, rank_points = rank_points + ? WHERE id = ?`).run(s.score, (s.score ?? 0) - existing, vivo.id);
        vivo = db.prepare('SELECT * FROM vivosaurs WHERE id = ?').get(vivo.id) as unknown as VivosaurRow;
      }
      db.prepare('DELETE FROM fossils WHERE id = ?').run(s.id);
    }
    db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
  } else {
    const existing = vivo[part];
    if (score > existing) {
      pointsGained = score - existing;
      db.prepare(`UPDATE vivosaurs SET ${part} = ?, rank_points = rank_points + ? WHERE id = ?`).run(score, pointsGained, vivo.id);
      vivo = db.prepare('SELECT * FROM vivosaurs WHERE id = ?').get(vivo.id) as unknown as VivosaurRow;
      db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
    } else {
      // A worse duplicate is donated for a little G.
      const dp = 50 + score * 2;
      db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(dp, user.id);
      db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
      return { success: true, score, fossil: null, message: `${species.name} ${part} cleaned at ${score}, but you already have a better one (${existing}). Donated for ${dp} G.`, vivosaur: viewVivosaur(vivo) };
    }
  }
  const view = viewVivosaur(vivo);
  const msg = newSpecies ? `${species.name} revived! (${score} points)` : `${species.name} ${part} integrated at ${score} points (+${pointsGained} rank points).`;
  return { success: true, score, fossil: null, message: msg, vivosaur: view, newSpecies, pointsGained };
}

export function integrateSuperFossil(db: DatabaseSync, user: UserRow, fossilId: number, vivosaurId: number): VivosaurView {
  const f = db.prepare('SELECT * FROM fossils WHERE id = ? AND user_id = ?').get(fossilId, user.id) as unknown as FossilRow | undefined;
  if (!f || f.state !== 'cleaned' || (f.kind !== 'wondrous' && f.kind !== 'miraculous')) throw new GameError('No such cleaned silver or gold fossil', 404);
  const v = db.prepare('SELECT * FROM vivosaurs WHERE id = ? AND user_id = ?').get(vivosaurId, user.id) as unknown as VivosaurRow | undefined;
  if (!v) throw new GameError('No such vivosaur', 404);
  if (f.kind === 'wondrous') {
    // A silver fossil replaces any previous silver fossil and reverts a super evolver to its base form's colours.
    db.prepare('UPDATE vivosaurs SET silver_part = ?, silver_score = ? WHERE id = ?').run(f.part, f.score, v.id);
  } else {
    db.prepare('UPDATE vivosaurs SET gold_score = ?, silver_part = NULL, silver_score = NULL WHERE id = ?').run(f.score, v.id);
  }
  db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
  return viewVivosaur(db.prepare('SELECT * FROM vivosaurs WHERE id = ?').get(v.id) as unknown as VivosaurRow);
}

export function setTeam(db: DatabaseSync, user: UserRow, ids: number[]): number[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3) throw new GameError('A team has 1 to 3 vivosaurs');
  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new GameError('Duplicate vivosaur in team');
  for (const id of ids) {
    const row = db.prepare('SELECT id FROM vivosaurs WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!row) throw new GameError('That vivosaur is not yours');
  }
  db.prepare('UPDATE users SET team_json = ? WHERE id = ?').run(JSON.stringify(ids), user.id);
  return ids;
}

export function teamMembers(db: DatabaseSync, user: UserRow): { ids: number[]; members: TeamMember[] } {
  const ids = (JSON.parse(user.team_json) as number[]).filter((id) => Number.isInteger(id));
  const members: TeamMember[] = [];
  const kept: number[] = [];
  for (const id of ids) {
    const row = db.prepare('SELECT * FROM vivosaurs WHERE id = ? AND user_id = ?').get(id, user.id) as unknown as VivosaurRow | undefined;
    if (!row) continue;
    members.push(toTeamMember(toOwned(row)));
    kept.push(id);
  }
  return { ids: kept, members };
}

export function awardBattle(db: DatabaseSync, userId: number, vivosaurIds: number[], gold: number, rankPoints: number, won: boolean | null) {
  db.prepare('UPDATE users SET gold = gold + ?, wins = wins + ?, losses = losses + ? WHERE id = ?').run(gold, won === true ? 1 : 0, won === false ? 1 : 0, userId);
  for (const id of vivosaurIds) {
    db.prepare('UPDATE vivosaurs SET rank_points = MIN(950, rank_points + ?) WHERE id = ? AND user_id = ?').run(rankPoints, id, userId);
  }
}

export function renameVivosaur(db: DatabaseSync, user: UserRow, id: number, nickname: string | null): VivosaurView {
  if (nickname !== null && !/^[A-Za-z0-9 '\-]{1,12}$/.test(nickname)) throw new GameError('Nicknames are 1 to 12 letters, numbers, spaces or dashes');
  const info = db.prepare('UPDATE vivosaurs SET nickname = ? WHERE id = ? AND user_id = ?').run(nickname, id, user.id);
  if (info.changes === 0) throw new GameError('No such vivosaur', 404);
  return viewVivosaur(db.prepare('SELECT * FROM vivosaurs WHERE id = ?').get(id) as unknown as VivosaurRow);
}

export function sellFossil(db: DatabaseSync, user: UserRow, fossilId: number): number {
  const f = db.prepare('SELECT * FROM fossils WHERE id = ? AND user_id = ?').get(fossilId, user.id) as unknown as FossilRow | undefined;
  if (!f) throw new GameError('No such fossil', 404);
  const offer = SHOP.find((o) => o.kind === f.kind && (o.element ?? null) === (f.kind === 'normal' ? f.element : null)) ?? SHOP[0];
  const value = Math.floor((f.state === 'cleaned' ? 0.4 : 0.25) * offer.price);
  db.prepare('DELETE FROM fossils WHERE id = ?').run(f.id);
  db.prepare('UPDATE users SET gold = gold + ? WHERE id = ?').run(value, user.id);
  return value;
}
