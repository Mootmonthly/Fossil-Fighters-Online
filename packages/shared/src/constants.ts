import type { Element, RangeClass, StatusKind } from './types.js';
import { FP_LEVELS } from './data/growth.js';

/**
 * Hero level table: FP gained per turn, FP cap, and FP at the start of a battle.
 * Source: the game's etc/btl_kp_defs table (gain and max agree with the wiki's Hero Level page).
 */
export const HERO_LEVELS: { gain: number; max: number; start: number }[] = FP_LEVELS.map((l) => ({ gain: l.gain, max: l.max, start: l.start }));

export const MAX_RANK = 20;
export const POINTS_PER_RANK = 50;
/** The first four skills unlock at these ranks; everything else (the team skill and any further skills) at FULL_SKILLS_RANK. */
export const SKILL_UNLOCK_RANKS = [1, 4, 8, 12];
export const FULL_SKILLS_RANK = 16;

export const ROTATION_FP_PER_STEP = 5;
export const ROTATION_FP_MAX = 15;

/** Element advantage: key beats value. Water > Fire > Earth > Air > Water. */
export const ELEMENT_BEATS: Record<Element, Element | null> = {
  water: 'fire', fire: 'earth', earth: 'air', air: 'water', neutral: null, legendary: null,
};

/** Range multipliers indexed by tile distance (1..7). Source: competitive Fossil Fighters wiki, Damage (FFC). */
export const RANGE_MULTIPLIERS: Record<RangeClass, number[]> = {
  close: [0, 1.875, 1.25, 1, 0.625, 0.5, 0.375, 0.25],
  mid: [0, 1, 1.25, 1.5, 1.25, 1, 0.75, 0.5],
  long: [0, 0.25, 0.5, 0.75, 1, 1.5, 1.75, 2],
};

export const CRIT_MULTIPLIER = 1.5;
export const CHARGE_MULTIPLIER = 2.5;
export const RANDOM_MULT_MIN = 0.75;
export const RANDOM_MULT_MAX = 0.85;

/** Status durations in the afflicted team's turns. */
export const STATUS_DURATION: Record<StatusKind, number> = {
  poison: 2, sleep: 1, scare: 2, excite: 2, confuse: 2, enrage: 2, infection: 4,
  enflame: 2, harden: 2, quicken: 2, counter: 2, charge: 1,
};

export const POISON_PERCENT = [0, 15, 30, 50];
export const SCARE_SEALED = [0, 2, 3];
export const ENRAGE_ATTACK = [0, 10, 20];
export const ENRAGE_ACCURACY = [0, 30, 35];
export const ENFLAME_ATTACK = [0, 20, 40];
export const ENFLAME_DEFENSE = [0, 5, 10];
export const HARDEN_DEFENSE = [0, 30, 50];
export const QUICKEN_SPEED_PERCENT = [0, 30, 70];
export const COUNTER_CHANCE = [0, 70, 100];
export const SLEEP_HITS = [0, 1, 2];
/** Infection KOs at the start of the victim's 4th turn after application. */
export const INFECTION_TURNS = 4;

/** Super Excite may rotate the team at the start of its turn. The exact rate is undocumented; 50% assumed. */
export const SUPER_EXCITE_ROTATE_CHANCE = 50;
/** Chance a confused vivosaur does nothing instead of attacking ("rarely"). Assumed 20%. */
export const CONFUSE_SKIP_CHANCE = 20;

/** Abilities. Values not documented on the wiki are marked as assumptions. */
export const AUTO_LP_RECOVERY_FRACTION = 1 / 20;
export const FP_ABSORB_FRACTION = 3 / 10;
export const AUTO_COUNTER_FRACTION = 3 / 10; // Champions: returns 3/10 of damage taken from physical (counterable) skills
export const SOLO_POWER_ATTACK_MULT = 2; // Champions: doubles Attack when it is the last vivosaur standing
export const LINK_DEFAULT_CHANCE = 70;
export const RESURRECT_TURNS = 3;
export const BERSERKER_LP_FRACTION = 0.5;
export const PARTING_BLOW_LP_FRACTION = 0.1;

/** Team skills lose power for every KO'd teammate. Exact figure undocumented; 25% per KO assumed. */
export const TEAM_SKILL_KO_PENALTY = 0.25;
/** Support effects are halved when two vivosaurs share the AZ (Jurassic formation). */
export const JURASSIC_SUPPORT_FACTOR = 0.5;

/**
 * Hero level used for every battle. It sets FP from the game's own table (data/growth.json): level 8 gives
 * 280 FP at the start, +140 per turn, 400 max, which suits ranked-up-but-not-maxed teams; level 20 (460 / +230 / 900)
 * is the story's end-game maximum and lets a team fire every skill every turn.
 */
export const BATTLE_HERO_LEVEL = 8;
export const DEFAULT_BATTLE_OPTIONS = { heroLevel: BATTLE_HERO_LEVEL, maxTurns: 120 };
