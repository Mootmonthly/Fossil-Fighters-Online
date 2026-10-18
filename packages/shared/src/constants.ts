import type { Element, RangeClass, StatusKind } from './types.js';

/** Hero level table (FP gained per turn / FP cap). Source: Fossil Fighters wiki, Hero Level (Champions). */
export const HERO_LEVELS: { gain: number; max: number }[] = [
  { gain: 70, max: 180 }, { gain: 80, max: 220 }, { gain: 90, max: 250 }, { gain: 100, max: 280 }, { gain: 110, max: 300 },
  { gain: 120, max: 330 }, { gain: 130, max: 360 }, { gain: 140, max: 400 }, { gain: 160, max: 450 }, { gain: 180, max: 500 },
  { gain: 185, max: 550 }, { gain: 190, max: 600 }, { gain: 195, max: 630 }, { gain: 200, max: 670 }, { gain: 205, max: 700 },
  { gain: 210, max: 730 }, { gain: 215, max: 750 }, { gain: 220, max: 770 }, { gain: 225, max: 800 }, { gain: 230, max: 900 },
];

export const MAX_RANK = 20;
export const POINTS_PER_RANK = 50;
/** Skills unlock at ranks 1, 3, 5 and 7 in Champions; the team skill is always available. */
export const SKILL_UNLOCK_RANKS = [1, 3, 5, 7];

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

export const DEFAULT_BATTLE_OPTIONS = { heroLevel: 20, maxTurns: 120 };
