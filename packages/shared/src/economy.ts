import type { Element, FossilPart } from './types.js';

export type RockKind = 'normal' | 'dark' | 'wondrous' | 'miraculous';

export interface RockOffer {
  kind: RockKind;
  /** Element colour of the rock, or null for a tan (unknown) rock. */
  element: Element | null;
  price: number;
  description: string;
}

/** Shop catalogue. Prices are tuned for match prizes, not the original game's dig-site economy. */
export const SHOP: RockOffer[] = [
  { kind: 'normal', element: null, price: 300, description: 'A plain fossil rock. Could hold any part of any vivosaur.' },
  { kind: 'normal', element: 'fire', price: 500, description: 'A red fossil rock: a part of a Fire-type vivosaur.' },
  { kind: 'normal', element: 'water', price: 500, description: 'A blue fossil rock: a part of a Water-type vivosaur.' },
  { kind: 'normal', element: 'earth', price: 500, description: 'A yellow fossil rock: a part of an Earth-type vivosaur.' },
  { kind: 'normal', element: 'air', price: 500, description: 'A green fossil rock: a part of an Air-type vivosaur.' },
  { kind: 'normal', element: 'neutral', price: 500, description: 'A white fossil rock: a part of a Neutral-type vivosaur.' },
  { kind: 'dark', element: null, price: 1500, description: 'A dark fossil rock. Always red-boned (+25 bonus points), always a head.' },
  { kind: 'wondrous', element: null, price: 10000, description: 'A wondrous fossil rock holding a silver fossil. Boosts a vivosaur and changes its colours.' },
  { kind: 'miraculous', element: null, price: 60000, description: 'A miraculous fossil rock holding a gold fossil. Boosts every stat; some vivosaurs super-evolve.' },
];

export const STARTING_GOLD = 6000;
export const STARTER_CHOICES = ['dimetro', 'toba', 'aeros', 'tsintao'];

export const PRIZE_WIN = 2500;
export const PRIZE_LOSS = 600;
export const PRIZE_DRAW = 1200;
export const PRIZE_SOLO_WIN = 800;
export const PRIZE_SOLO_LOSS = 200;
/** Rank points awarded to every vivosaur that fought. */
export const RANK_POINTS_WIN = 30;
export const RANK_POINTS_LOSS = 15;
export const RANK_POINTS_SOLO = 12;

export const PARTS: FossilPart[] = ['head', 'body', 'arms', 'legs'];

/** Minimum cleaning score to integrate a fossil. */
export const MIN_CLEAN_SCORE = 50;
export const CLEANING_TIME_SECONDS = 90;
