import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  gold: number;
  hero_level: number;
  wins: number;
  losses: number;
  team_json: string;
  is_admin: number;
  elo: number;
  muted: number;
  created_at: string;
}

export interface VivosaurRow {
  id: number;
  user_id: number;
  species_id: string;
  nickname: string | null;
  rank_points: number;
  head: number;
  body: number;
  arms: number;
  legs: number;
  silver_part: string | null;
  silver_score: number | null;
  gold_score: number | null;
}

export interface FossilRow {
  id: number;
  user_id: number;
  kind: string;
  element: string | null;
  species_id: string | null;
  part: string | null;
  red_boned: number;
  state: string; // 'rock' | 'cleaned'
  score: number | null;
  rock_seed: number;
  /** 1 when the player knows the species inside (featured shop, admin grants). */
  known: number;
  created_at: string;
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      gold INTEGER NOT NULL DEFAULT 0,
      hero_level INTEGER NOT NULL DEFAULT 20,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      team_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vivosaurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      species_id TEXT NOT NULL,
      nickname TEXT,
      rank_points INTEGER NOT NULL DEFAULT 0,
      head INTEGER NOT NULL DEFAULT 0,
      body INTEGER NOT NULL DEFAULT 0,
      arms INTEGER NOT NULL DEFAULT 0,
      legs INTEGER NOT NULL DEFAULT 0,
      silver_part TEXT,
      silver_score INTEGER,
      gold_score INTEGER,
      UNIQUE(user_id, species_id)
    );
    CREATE TABLE IF NOT EXISTS fossils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      element TEXT,
      species_id TEXT,
      part TEXT,
      red_boned INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'rock',
      score INTEGER,
      rock_seed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      p1_user INTEGER,
      p2_user INTEGER,
      p1_name TEXT NOT NULL,
      p2_name TEXT NOT NULL,
      winner INTEGER,
      seed INTEGER NOT NULL,
      turns INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS match_vivosaurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER,
      side INTEGER NOT NULL,
      species_id TEXT NOT NULL,
      won INTEGER,
      kind TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS featured_purchases (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bucket INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      PRIMARY KEY (user_id, bucket, slot)
    );
    CREATE INDEX IF NOT EXISTS idx_vivosaurs_user ON vivosaurs(user_id);
    CREATE INDEX IF NOT EXISTS idx_fossils_user ON fossils(user_id);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_match_vivosaurs_species ON match_vivosaurs(species_id);
  `);
  // Columns added after the first release.
  addColumn(db, 'users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'fossils', 'known', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'users', 'elo', 'INTEGER NOT NULL DEFAULT 1000');
  addColumn(db, 'users', 'muted', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'matches', 'elo_change', 'INTEGER');
  return db;
}

function addColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
