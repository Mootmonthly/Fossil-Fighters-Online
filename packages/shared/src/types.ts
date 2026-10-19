// Shared data and battle types for Fossil Fighters Online.

export type Element = 'fire' | 'water' | 'earth' | 'air' | 'neutral' | 'legendary';
export type RangeClass = 'close' | 'mid' | 'long';
export type StatKey = 'attack' | 'defense' | 'accuracy' | 'speed';

export interface Stats {
  lp: number;
  attack: number;
  defense: number;
  accuracy: number;
  speed: number;
}

/** Status conditions. Tier 1 = normal (silver), 2 = super (gold), 3 = venom (poison only). */
export type StatusKind =
  | 'poison' | 'sleep' | 'scare' | 'excite' | 'confuse' | 'enrage' | 'infection'
  | 'enflame' | 'harden' | 'quicken' | 'counter' | 'charge';

export type StatusTier = 1 | 2 | 3;

export type SkillTarget = 'enemy' | 'allEnemies' | 'self' | 'ally' | 'allAllies' | 'none';

export type SkillEffect =
  | { type: 'status'; status: StatusKind; tier: StatusTier; chance: number; target: 'hit' | 'self' | 'ally' }
  | { type: 'rotate'; chance: number }
  | { type: 'heal'; amount: number; target: 'ally' | 'allAllies' }
  | { type: 'cure'; target: 'ally' | 'allAllies' }
  | { type: 'lawOfTheJungle' }
  | { type: 'sacrifice' }
  | { type: 'equalizeFP' }
  | { type: 'stealFP'; amount: number; chance: number }
  | { type: 'drain' }
  | { type: 'spite' }
  | { type: 'transform'; into: string[] }
  | { type: 'randomBuff' }
  /** Inflicts a random negative status on each target hit. */
  | { type: 'randomStatus' }
  /** The listed power is split over several hits against random enemies. */
  | { type: 'multiHit'; hits: number }
  | { type: 'instantKO'; chance: number };

export interface SkillData {
  id: string;
  name: string;
  /** Total move power listed in game (vivosaur Attack + hidden base power) at max rank, or null for non-damaging skills. */
  power: number | null;
  /** Hidden base power from the game data (power = Attack + basePower). */
  basePower?: number;
  /** Lower-rank versions of the skill stored in the game data (FP cost and base power), weakest first. */
  tiers?: { fp: number; basePower: number }[];
  romId?: number;
  fp: number;
  kind: 'attack' | 'support' | 'team';
  target: SkillTarget;
  counterable: boolean;
  effects: SkillEffect[];
  text: string;
}

export type AbilityType =
  | 'fpPlus' | 'autoCounter' | 'autoLpRecovery' | 'partingBlow' | 'link' | 'fpAbsorb' | 'soloPower'
  | 'elementalBoost' | 'sleepy' | 'hardenPlus' | 'counterPlus' | 'quickenPlus' | 'enflamePlusS'
  | 'positionLock' | 'resurrect' | 'berserker';

export interface AbilityData {
  type: AbilityType;
  value?: number;
}

export interface SupportEffects {
  target: 'own' | 'enemy';
  attack?: number;
  defense?: number;
  accuracy?: number;
  speed?: number;
}

export interface VivosaurData {
  id: string;
  num: string;
  name: string;
  element: Element;
  range: RangeClass;
  diet: string | null;
  size: string | null;
  /** Stats at max rank (20). */
  stats: Stats;
  /** LP at ranks 1..20 from the game data. */
  lpByRank?: number[];
  /** Rank-1 value, minimum, max-rank value and growth pattern index for each stat, from the game data. */
  statCurves?: Record<StatKey, { rank1: number; min: number; max: number; pattern: number }>;
  /** Damage percentage by tile distance 0..7 from the game data (80 = the community wiki's 1.0). */
  rangeTable?: number[];
  romId?: number;
  /** Price of this species' rocks in the featured shop (from the game's rock table, or its price tier). */
  shopPrice?: number;
  shopPriceSource?: 'rom' | 'tier';
  /** Critical hit rate percentage. */
  crit: number;
  skills: SkillData[];
  support: SupportEffects | null;
  abilities: AbilityData[];
  superEvolvesInto: string | null;
  baseForm: string | null;
  partingBlow: { atkAcc: number; defSpd: number } | null;
  description: string | null;
  /** Team skill compatibility groups. */
  groups: number[];
}

// ---------------------------------------------------------------------------
// Player-owned vivosaur (progression layer)
// ---------------------------------------------------------------------------

export type FossilPart = 'head' | 'body' | 'arms' | 'legs';

export interface OwnedVivosaur {
  id: number;
  speciesId: string;
  nickname: string | null;
  /** Rank points: 50 per rank, rank = 1 + floor(points / 50), max rank 20. */
  rankPoints: number;
  /** Cleaning scores of integrated parts (0 = not integrated). */
  parts: Record<FossilPart, number>;
  /** Integrated silver (wondrous) fossil, if any. */
  silver: { part: FossilPart; score: number } | null;
  /** Integrated gold (miraculous) fossil score, if any. */
  gold: number | null;
}

// ---------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------

/**
 * Zones form a ring of six hexes per side. Depth 0 is the front-most tile (AZ+), depth 3 the rear (SZ+).
 *   0 = AZ+ (depth 0)   1 = AZ right (depth 1)   2 = SZ right (depth 2)
 *   3 = SZ+ (depth 3)   4 = SZ left (depth 2)    5 = AZ left (depth 1)
 * Rotating one step moves every vivosaur to the next zone in the ring, alternating between the
 * Cambrian formation {0,2,4} (one AZ, two SZ) and the Jurassic formation {1,3,5} (two AZ, one SZ).
 */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5;

export interface StatusInstance {
  kind: StatusKind;
  tier: StatusTier;
  /** Remaining turns (decremented at the end of the afflicted team's turn). */
  turns: number;
}

export interface BattleVivosaur {
  slot: number;
  /** Current species id (may change through transformation). */
  speciesId: string;
  baseSpeciesId: string;
  name: string;
  rank: number;
  maxLp: number;
  lp: number;
  /** Rank/fossil adjusted base stats, before support effects and statuses. */
  stats: Stats;
  crit: number;
  zone: Zone;
  statuses: StatusInstance[];
  /** Indices of skills sealed by Scare. */
  sealed: number[];
  /** Hits remaining before waking from Sleep. */
  sleepHits: number;
  /** Infection countdown (own-turn starts remaining), 0 = not infected. */
  infection: number;
  /** Turns until Resurrect triggers (0 = none). */
  resurrectIn: number;
  acted: boolean;
  ko: boolean;
  /** Set when a KO'd vivosaur has already been resurrected once. */
  resurrected: boolean;
}

export interface BattleSide {
  id: string;
  name: string;
  vivosaurs: BattleVivosaur[];
  fp: number;
  fpGain: number;
  fpMax: number;
  /** FP spent on manual rotation since the last attack this turn (resets after a skill). */
  rotationSpent: number;
  teamCompatible: boolean;
  heroLevel: number;
}

export type BattleEvent =
  | { type: 'battleStart'; first: 0 | 1; speeds: [number, number] }
  | { type: 'turnStart'; side: 0 | 1; turn: number; fp: number; fpGained: number }
  | { type: 'turnEnd'; side: 0 | 1 }
  | { type: 'rotate'; side: 0 | 1; steps: number; cause: 'manual' | 'skill' | 'excite'; fpCost: number }
  | { type: 'skill'; side: 0 | 1; slot: number; skillId: string; skillName: string; fpCost: number; targets: { side: 0 | 1; slot: number }[] }
  | { type: 'miss'; side: 0 | 1; slot: number }
  | { type: 'damage'; side: 0 | 1; slot: number; amount: number; crit: boolean; elementMult: number; rangeMult: number; countered: boolean; source: 'skill' | 'counter' | 'autoCounter' | 'poison' | 'infection' | 'spite' | 'lawOfTheJungle' | 'sacrifice' }
  | { type: 'heal'; side: 0 | 1; slot: number; amount: number; source: string }
  | { type: 'status'; side: 0 | 1; slot: number; status: StatusKind; tier: StatusTier; applied: boolean }
  | { type: 'cure'; side: 0 | 1; slot: number }
  | { type: 'statusExpired'; side: 0 | 1; slot: number; status: StatusKind }
  | { type: 'ko'; side: 0 | 1; slot: number }
  | { type: 'resurrect'; side: 0 | 1; slot: number }
  | { type: 'transform'; side: 0 | 1; slot: number; from: string; to: string }
  | { type: 'fp'; side: 0 | 1; amount: number; source: string }
  | { type: 'confused'; side: 0 | 1; slot: number; acted: boolean }
  | { type: 'link'; side: 0 | 1; slot: number }
  | { type: 'wake'; side: 0 | 1; slot: number }
  | { type: 'forfeit'; side: 0 | 1 }
  | { type: 'battleEnd'; winner: 0 | 1 | null; reason: string };

export interface BattleOptions {
  /** Hero level used for FP gain/max; both sides use the same level in ranked play. */
  heroLevel: number;
  /** Battle ends in a draw when this many side-turns have elapsed. */
  maxTurns: number;
}

export interface BattleState {
  seed: number;
  rng: number;
  options: BattleOptions;
  sides: [BattleSide, BattleSide];
  /** Side whose turn it is. */
  active: 0 | 1;
  /** Side-turn counter (increments every time a side starts its turn). */
  turn: number;
  phase: 'active' | 'finished';
  winner: 0 | 1 | null;
  endReason: string | null;
  /** Events generated since the battle began (consumers may truncate). */
  log: BattleEvent[];
}

export type BattleAction =
  | { type: 'skill'; slot: number; skill: number; target?: { side: 0 | 1; slot: number } }
  | { type: 'rotate'; steps: 1 | 2 | 3; direction: 1 | -1 }
  | { type: 'endTurn' }
  | { type: 'forfeit' };

/** Team definition handed to the engine: three vivosaurs with progression applied. */
export interface TeamMember {
  speciesId: string;
  nickname?: string | null;
  rank: number;
  /** Final stats after rank scaling and silver/gold bonuses. */
  stats: Stats;
}

export interface TeamSetup {
  id: string;
  name: string;
  /** The vivosaurs in slot order (slot 0 is the front of the formation). */
  members: TeamMember[];
  heroLevel?: number;
  /** Starting formation; Cambrian when omitted. */
  formation?: 'cambrian' | 'jurassic';
}
