import { describe, expect, it } from 'vitest';
import { applyAction, createBattle, previewDamage, rotationCost, skillAvailability, supportPercent } from './engine.js';
import { playAiTurn } from './ai.js';
import { getVivosaur, isTeamCompatible, VIVOSAURS } from './data/index.js';
import { memberAtRank } from './progression.js';
import { tileDistance } from './field.js';
import type { TeamSetup } from './types.js';

function team(id: string, ids: string[]): TeamSetup {
  return { id, name: id, members: ids.map((s) => memberAtRank(s, 20)) };
}

describe('data', () => {
  it('loads vivosaurs with complete stats', () => {
    expect(VIVOSAURS.length).toBeGreaterThan(50);
    for (const v of VIVOSAURS) {
      expect(v.stats.lp, v.name).toBeGreaterThan(0);
      expect(v.skills.length, v.name).toBeGreaterThan(0);
      expect(['close', 'mid', 'long']).toContain(v.range);
    }
  });
  it('T-Rex matches the wiki', () => {
    const t = getVivosaur('t_rex');
    expect(t.stats).toEqual({ lp: 600, attack: 99, defense: 50, accuracy: 43, speed: 12 });
    expect(t.crit).toBe(15);
    expect(t.skills.find((s) => s.name === 'Scare Tactics')?.power).toBe(166);
    expect(t.support).toEqual({ target: 'own', attack: -30, defense: -30, accuracy: -30, speed: -30 });
  });
  it('uses the game\'s per-rank tables', () => {
    const t = getVivosaur('t_rex');
    expect(t.lpByRank?.[0]).toBe(90);
    expect(t.lpByRank?.[19]).toBe(600);
    expect(memberAtRank('t_rex', 1).stats).toEqual({ lp: 90, attack: 55, defense: 25, accuracy: 39, speed: 10 });
    expect(memberAtRank('t_rex', 20).stats).toEqual({ lp: 600, attack: 99, defense: 50, accuracy: 43, speed: 12 });
    expect(t.rangeTable).toEqual([150, 150, 100, 80, 50, 40, 30, 20]);
    expect(t.skills[1].basePower).toBe(67);
  });
  it('team compatibility follows the group lists', () => {
    expect(isTeamCompatible(['t_rex', 'guan', 'gorgo'])).toBe(true); // all Fire
    expect(isTeamCompatible(['t_rex', 'compso', 'tricera'])).toBe(false);
  });
});

describe('field', () => {
  it('distances span 1..7', () => {
    expect(tileDistance(0, 0)).toBe(1);
    expect(tileDistance(3, 3)).toBe(7);
    expect(tileDistance(0, 3)).toBe(4);
  });
});

describe('battle', () => {
  it('starts with the faster team and recharges FP', () => {
    const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 1, { heroLevel: 20 });
    expect(st.log[0].type).toBe('battleStart');
    // Compso's team is faster (speed 25+21+18 vs 12+20+15) and Compso has FP Plus 30%.
    // Level 20 starts a battle with 460 FP and gains 230 per turn (ROM btl_kp_defs); the default level is lower.
    expect(st.active).toBe(1);
    expect(st.sides[1].fp).toBe(460 + Math.floor(230 * 1.3));
    expect(st.sides[1].fpMax).toBe(900);
    expect(st.sides[0].fp).toBe(460);
  });

  it('applies support effects to the AZ vivosaur', () => {
    const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 1);
    // Guan (own SZ) gives +90% attack to own AZ; Pelto (enemy SZ) lowers enemy AZ attack by 40%.
    const trex = st.sides[0].vivosaurs[0];
    expect(supportPercent(st, 0, trex, 'attack')).toBe(90 - 40);
    expect(supportPercent(st, 0, trex, 'accuracy')).toBe(-10); // Gorgo
    // Jurassic formation halves support for each AZ vivosaur.
    applyAction(st, 1, { type: 'endTurn' });
    applyAction(st, 0, { type: 'rotate', steps: 1, direction: 1 });
    const az = st.sides[0].vivosaurs.filter((v) => v.zone === 1 || v.zone === 5);
    expect(az.length).toBe(2);
    const sz = st.sides[0].vivosaurs.find((v) => v.zone === 3)!;
    const szSupport = getVivosaur(sz.speciesId).support!;
    for (const v of az) expect(supportPercent(st, 0, v, 'attack')).toBe(((szSupport.target === 'own' ? szSupport.attack ?? 0 : 0) - 40) / 2);
  });

  it('computes T-Rex Scare Tactics damage within the formula range', () => {
    const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 1);
    const p = previewDamage(st, 0, 0, 1, { side: 1, slot: 0 })!;
    // Attack 99 + base 67 = 166, with Guan 90% and Gorgo support; Compso def 11 → no def support in Cambrian from own side except Pelto/Tricera (SZ)
    expect(p.distance).toBe(1);
    expect(p.rangeMult).toBe(1.875);
    expect(p.elementMult).toBe(1.5); // Fire beats Earth
    expect(p.min).toBeGreaterThan(0);
    expect(p.max).toBeGreaterThanOrEqual(p.min);
  });

  it('rotation costs 5 FP per step up to 15 and alternates formations', () => {
    const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 1);
    const s = st.active;
    expect(rotationCost(st.sides[s], 1)).toBe(5);
    applyAction(st, s, { type: 'rotate', steps: 1, direction: 1 });
    expect(st.sides[s].vivosaurs.map((v) => v.zone).sort()).toEqual([1, 3, 5]);
    expect(rotationCost(st.sides[s], 3)).toBe(10);
    applyAction(st, s, { type: 'rotate', steps: 3, direction: 1 });
    expect(st.sides[s].rotationSpent).toBe(15);
    expect(rotationCost(st.sides[s], 1)).toBe(0);
  });

  it('rejects acting out of turn and double actions', () => {
    const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 1);
    const s = st.active;
    const o = s === 0 ? 1 : 0;
    expect(() => applyAction(st, o, { type: 'endTurn' })).toThrow();
    applyAction(st, s, { type: 'skill', slot: 0, skill: 0, target: { side: o, slot: 0 } });
    expect(st.sides[s].vivosaurs[0].acted).toBe(true);
    expect(skillAvailability(st, s, 0)[0].usable).toBe(false);
    expect(() => applyAction(st, s, { type: 'skill', slot: 0, skill: 0, target: { side: o, slot: 0 } })).toThrow();
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const st = createBattle([team('a', ['t_rex', 'guan', 'gorgo']), team('b', ['compso', 'tricera', 'pelto'])], 42);
      for (let i = 0; i < 40 && st.phase === 'active'; i++) playAiTurn(st, st.active);
      return JSON.stringify(st.log);
    };
    expect(run()).toBe(run());
  });

  it('AI battles finish with a winner', () => {
    let finished = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ids = VIVOSAURS.filter((v) => !v.baseForm).map((v) => v.id);
      const pick = (n: number) => ids[(seed * 7 + n * 13) % ids.length];
      const st = createBattle([team('a', [pick(1), pick(2), pick(3)]), team('b', [pick(4), pick(5), pick(6)])], seed, { maxTurns: 200 });
      for (let i = 0; i < 400 && st.phase === 'active'; i++) playAiTurn(st, st.active);
      if (st.phase === 'finished') finished++;
    }
    expect(finished).toBe(6);
  });
});
