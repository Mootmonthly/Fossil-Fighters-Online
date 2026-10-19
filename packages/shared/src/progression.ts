import { FULL_SKILLS_RANK, MAX_RANK, POINTS_PER_RANK, SKILL_UNLOCK_RANKS } from './constants.js';
import { getVivosaur } from './data/index.js';
import { GROWTH_PATTERNS } from './data/growth.js';
import type { FossilPart, OwnedVivosaur, StatKey, Stats, TeamMember, VivosaurData } from './types.js';

export function rankFromPoints(points: number): number {
  return Math.min(MAX_RANK, 1 + Math.floor(Math.max(0, points) / POINTS_PER_RANK));
}

export function pointsToNextRank(points: number): number {
  const rank = rankFromPoints(points);
  if (rank >= MAX_RANK) return 0;
  return rank * POINTS_PER_RANK - points;
}

/**
 * Stat at a rank, from the game's own tables.
 * LP uses the per-rank table stored for every vivosaur. Attack, Defense, Accuracy and Speed use the
 * vivosaur's rank-1 value, max-rank value and one of the game's growth patterns (20 values in 1/4096
 * units, 410 at rank 1 to 4096 at rank 20); the pattern is normalised so rank 1 gives the rank-1 value
 * and rank 20 the maximum. Vivosaurs without ROM curves fall back to a linear ramp from 40 %.
 */
export function statAtRank(species: VivosaurData, stat: StatKey | 'lp', rank: number): number {
  const r = Math.min(MAX_RANK, Math.max(1, Math.round(rank)));
  if (stat === 'lp') {
    if (species.lpByRank && species.lpByRank.length === MAX_RANK) return species.lpByRank[r - 1];
    return Math.max(1, Math.round(species.stats.lp * (0.5 + 0.5 * ((r - 1) / (MAX_RANK - 1)))));
  }
  const curve = species.statCurves?.[stat];
  const max = species.stats[stat];
  if (!curve) return Math.max(1, Math.round(max * (0.4 + 0.6 * ((r - 1) / (MAX_RANK - 1)))));
  const pattern = GROWTH_PATTERNS[curve.pattern] ?? GROWTH_PATTERNS[1];
  const p0 = pattern[0], p19 = pattern[MAX_RANK - 1];
  const t = p19 === p0 ? 1 : (pattern[r - 1] - p0) / (p19 - p0);
  return Math.max(1, Math.round(curve.rank1 + (curve.max - curve.rank1) * t));
}

export function statsAtRank(species: VivosaurData, rank: number): Stats {
  return {
    lp: statAtRank(species, 'lp', rank),
    attack: statAtRank(species, 'attack', rank),
    defense: statAtRank(species, 'defense', rank),
    accuracy: statAtRank(species, 'accuracy', rank),
    speed: statAtRank(species, 'speed', rank),
  };
}

/** Silver (wondrous) fossil bonuses at a 100-point cleaning. Source: ROM creature_evolution_abilityup_param_defs. */
export const SILVER_BONUS: Record<FossilPart, Partial<Stats>> = {
  head: { lp: 20, attack: 5, accuracy: 5 },
  body: { lp: 20, defense: 10 },
  arms: { lp: 20, attack: 10 },
  legs: { lp: 20, defense: 5, speed: 5 },
};

/** Gold (miraculous) fossil bonus at a 100-point cleaning. */
export const GOLD_BONUS: Stats = { lp: 100, attack: 5, defense: 5, accuracy: 5, speed: 5 };

export function effectiveSpecies(owned: OwnedVivosaur): VivosaurData {
  const base = getVivosaur(owned.speciesId);
  // A gold fossil super-evolves eligible vivosaurs; a silver fossil reverts them.
  if (owned.gold !== null && owned.silver === null && base.superEvolvesInto) {
    return getVivosaur(base.superEvolvesInto);
  }
  return base;
}

export function computeStats(owned: OwnedVivosaur): Stats {
  const species = effectiveSpecies(owned);
  const rank = rankFromPoints(owned.rankPoints);
  const stats = statsAtRank(species, rank);
  if (owned.silver) {
    const scale = Math.min(100, Math.max(0, owned.silver.score)) / 100;
    for (const [k, v] of Object.entries(SILVER_BONUS[owned.silver.part])) {
      stats[k as keyof Stats] += Math.round((v ?? 0) * scale);
    }
  }
  if (owned.gold !== null) {
    const scale = Math.min(100, Math.max(0, owned.gold)) / 100;
    for (const k of Object.keys(GOLD_BONUS) as (keyof Stats)[]) stats[k] += Math.round(GOLD_BONUS[k] * scale);
  }
  return stats;
}

/** Number of regular skills unlocked at a rank (the team skill is always available). */
export function unlockedSkillCount(rank: number): number {
  return SKILL_UNLOCK_RANKS.filter((r) => rank >= r).length;
}

/** True once every skill, including the team skill, is available. */
export function allSkillsUnlocked(rank: number): boolean {
  return rank >= FULL_SKILLS_RANK;
}

export function toTeamMember(owned: OwnedVivosaur): TeamMember {
  return {
    speciesId: effectiveSpecies(owned).id,
    nickname: owned.nickname,
    rank: rankFromPoints(owned.rankPoints),
    stats: computeStats(owned),
  };
}

/** Convenience for AI/test teams: a species at a given rank with no fossils. */
export function memberAtRank(speciesId: string, rank = MAX_RANK): TeamMember {
  const owned: OwnedVivosaur = { id: 0, speciesId, nickname: null, rankPoints: (rank - 1) * POINTS_PER_RANK, parts: { head: 100, body: 100, arms: 100, legs: 100 }, silver: null, gold: null };
  return toTeamMember(owned);
}
