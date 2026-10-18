import { MAX_RANK, POINTS_PER_RANK, SKILL_UNLOCK_RANKS } from './constants.js';
import { getVivosaur } from './data/index.js';
import type { FossilPart, OwnedVivosaur, Stats, TeamMember, VivosaurData } from './types.js';

export function rankFromPoints(points: number): number {
  return Math.min(MAX_RANK, 1 + Math.floor(Math.max(0, points) / POINTS_PER_RANK));
}

export function pointsToNextRank(points: number): number {
  const rank = rankFromPoints(points);
  if (rank >= MAX_RANK) return 0;
  return rank * POINTS_PER_RANK - points;
}

/**
 * Stat growth by rank. The wiki documents max-rank stats only; growth is assumed linear from 40% of the
 * maximum at rank 1 to 100% at rank 20 (LP from 50%).
 */
export function statAtRank(max: number, rank: number, isLp = false): number {
  const r = Math.min(MAX_RANK, Math.max(1, rank));
  const floor = isLp ? 0.5 : 0.4;
  const frac = floor + (1 - floor) * ((r - 1) / (MAX_RANK - 1));
  return Math.max(1, Math.round(max * frac));
}

/** Silver (wondrous) fossil bonuses at a 100-point cleaning. Source: wiki, Silver Fossils. */
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
  const stats: Stats = {
    lp: statAtRank(species.stats.lp, rank, true),
    attack: statAtRank(species.stats.attack, rank),
    defense: statAtRank(species.stats.defense, rank),
    accuracy: statAtRank(species.stats.accuracy, rank),
    speed: statAtRank(species.stats.speed, rank),
  };
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
