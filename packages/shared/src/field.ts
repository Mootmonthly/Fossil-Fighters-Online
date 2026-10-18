import type { Zone } from './types.js';

export const ZONE_DEPTH: Record<Zone, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 2, 5: 1 };
export const ZONE_NAMES: Record<Zone, string> = { 0: 'AZ+', 1: 'AZ', 2: 'SZ', 3: 'SZ+', 4: 'SZ', 5: 'AZ' };

export function isAttackZone(zone: Zone): boolean {
  return ZONE_DEPTH[zone] <= 1;
}

export function isSupportZone(zone: Zone): boolean {
  return ZONE_DEPTH[zone] >= 2;
}

/** Tile distance between a zone on one side and a zone on the other side (1..7). */
export function tileDistance(a: Zone, b: Zone): number {
  return ZONE_DEPTH[a] + ZONE_DEPTH[b] + 1;
}

export function rotateZone(zone: Zone, steps: number): Zone {
  return ((((zone + steps) % 6) + 6) % 6) as Zone;
}

/** Cambrian formation (one AZ, two SZ) starting zones for team slots 0..2. */
export const START_ZONES: Zone[] = [0, 2, 4];
