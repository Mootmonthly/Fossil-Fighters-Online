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
    CREATE INDEX IF NOT EXISTS idx_vivosaurs_user ON vivosaurs(user_id);
    CREATE INDEX IF NOT EXISTS idx_fossils_user ON fossils(user_id);
  `);
  return db;
}
