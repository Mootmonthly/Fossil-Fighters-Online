import growthRaw from './growth.json' with { type: 'json' };

interface GrowthFile {
  patterns: Record<string, number[]>;
  fpLevels: { level: number; max: number; gain: number; start: number; exp: number }[];
  statuses: unknown[];
  superRevivalBonuses: unknown[];
}

const growth = growthRaw as unknown as GrowthFile;

/** Rank growth patterns from the game (etc/rank_growth_pattern_defs): 20 values in 1/4096 units per pattern. */
export const GROWTH_PATTERNS: Record<number, number[]> = Object.fromEntries(Object.entries(growth.patterns).map(([k, v]) => [Number(k), v]));

/** Hero level FP table from the game (etc/btl_kp_defs): max FP, FP gained per turn, FP at battle start. */
export const FP_LEVELS = growth.fpLevels.map((l) => ({ level: l.level, max: l.max, gain: l.gain, start: l.start }));
