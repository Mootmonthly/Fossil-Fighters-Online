import rawData from './vivosaurs.json' with { type: 'json' };
import type { VivosaurData } from '../types.js';

export const VIVOSAURS: VivosaurData[] = rawData as unknown as VivosaurData[];

const byId = new Map<string, VivosaurData>();
for (const v of VIVOSAURS) byId.set(v.id, v);

export function getVivosaur(id: string): VivosaurData {
  const v = byId.get(id);
  if (!v) throw new Error(`Unknown vivosaur: ${id}`);
  return v;
}

export function findVivosaur(id: string): VivosaurData | undefined {
  return byId.get(id);
}

/** Vivosaurs that can be found in fossil rocks (excludes super evolvers and event/legendary vivosaurs). */
export function obtainableVivosaurs(): VivosaurData[] {
  return VIVOSAURS.filter((v) => !v.baseForm && v.element !== 'legendary' && Number(v.num) <= 150);
}

/** True when all members share at least one team-skill compatibility group. */
export function isTeamCompatible(ids: string[]): boolean {
  const vs = ids.map((id) => byId.get(id)).filter((v): v is VivosaurData => !!v);
  if (vs.length !== ids.length || vs.length === 0) return false;
  if (vs.some((v) => v.groups.length === 0)) return false;
  const first = new Set(vs[0].groups);
  for (const v of vs.slice(1)) {
    for (const g of [...first]) if (!v.groups.includes(g)) first.delete(g);
  }
  return first.size > 0;
}
