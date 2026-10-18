import { applyAction, canRotate, cloneState, getStatus, previewDamage, rotationCost, skillAvailability } from './engine.js';
import type { BattleAction, BattleState, BattleVivosaur } from './types.js';

type SideIndex = 0 | 1;

interface Candidate {
  action: BattleAction;
  score: number;
}

const NEGATIVE = ['poison', 'sleep', 'scare', 'excite', 'confuse', 'enrage'] as const;

/** Expected value of a damaging skill against one target (hit assumed, average roll). */
function attackScore(state: BattleState, s: SideIndex, slot: number, skillIdx: number, target: BattleVivosaur, ts: SideIndex): number {
  const p = previewDamage(state, s, slot, skillIdx, { side: ts, slot: target.slot });
  if (!p) return 0;
  const avg = (p.min + p.max) / 2;
  let score = Math.min(avg, target.lp);
  if (avg >= target.lp) score += 120; // KO bonus
  const skill = state.sides[s].vivosaurs[slot];
  const data = skillAvailability(state, s, slot)[skillIdx].skill;
  for (const e of data.effects) {
    if (e.type === 'status' && e.target === 'hit') score += (e.chance / 100) * (e.status === 'confuse' ? 70 : e.status === 'infection' ? 150 : 40) * e.tier;
    if (e.type === 'drain') score += avg * 0.5;
  }
  void skill;
  return score;
}

/**
 * Picks one action for the active side. Returns an endTurn action when nothing worthwhile remains.
 * Greedy heuristic: best damage-per-FP with KO and status bonuses, Rallying Cry when an ally is debuffed,
 * and a one-step rotation when it clearly improves the best attack.
 */
export function chooseAction(state: BattleState, s: SideIndex): BattleAction {
  if (state.phase !== 'active' || state.active !== s) return { type: 'endTurn' };
  const side = state.sides[s];
  const enemy = state.sides[s === 0 ? 1 : 0];
  const enemies = enemy.vivosaurs.filter((v) => !v.ko);
  const candidates: Candidate[] = [];

  for (const v of side.vivosaurs) {
    if (v.ko || v.acted) continue;
    for (const a of skillAvailability(state, s, v.slot)) {
      if (!a.usable) continue;
      const skill = a.skill;
      const costFactor = 1 + skill.fp / 150;
      if (skill.power !== null) {
        if (skill.target === 'allEnemies') {
          let total = 0;
          for (const e of enemies) total += attackScore(state, s, v.slot, a.index, e, s === 0 ? 1 : 0);
          candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index }, score: total / costFactor });
        } else {
          for (const e of enemies) {
            const sc = attackScore(state, s, v.slot, a.index, e, s === 0 ? 1 : 0);
            candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index, target: { side: s === 0 ? 1 : 0, slot: e.slot } }, score: sc / costFactor });
          }
        }
        continue;
      }
      // Support skills
      for (const eff of skill.effects) {
        if (eff.type === 'cure') {
          const allies = side.vivosaurs.filter((x) => !x.ko && x.statuses.some((st) => (NEGATIVE as readonly string[]).includes(st.kind)));
          if (eff.target === 'allAllies' && allies.length) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index }, score: 60 * allies.length });
          if (eff.target === 'ally') for (const al of allies) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index, target: { side: s, slot: al.slot } }, score: 70 + (al.slot === v.slot ? 0 : 10) });
        } else if (eff.type === 'heal') {
          if (eff.target === 'allAllies') {
            const missing = side.vivosaurs.filter((x) => !x.ko).reduce((acc, x) => acc + Math.min(eff.amount, x.maxLp - x.lp), 0);
            if (missing > eff.amount) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index }, score: missing * 0.6 });
          } else {
            for (const al of side.vivosaurs.filter((x) => !x.ko)) {
              const missing = Math.min(eff.amount, al.maxLp - al.lp);
              if (missing >= eff.amount * 0.6) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index, target: { side: s, slot: al.slot } }, score: missing * 0.6 });
            }
          }
        } else if (eff.type === 'status' && (eff.target === 'self' || eff.target === 'ally')) {
          if (side.fp > side.fpMax * 0.6 && !getStatus(v, eff.status)) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index, target: eff.target === 'ally' ? { side: s, slot: v.slot } : undefined }, score: 25 });
        } else if (eff.type === 'transform') {
          if (v.lp < v.maxLp * 0.5) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index }, score: 90 });
        } else if (eff.type === 'stealFP') {
          if (enemy.fp >= eff.amount * 0.7) candidates.push({ action: { type: 'skill', slot: v.slot, skill: a.index, target: { side: s === 0 ? 1 : 0, slot: enemies[0]?.slot ?? 0 } }, score: (eff.chance / 100) * eff.amount * 0.4 });
        }
      }
    }
  }

  // Consider a one-step rotation when it clearly improves our best attack.
  const best = candidates.reduce<Candidate | null>((b, c) => (!b || c.score > b.score ? c : b), null);
  const rot = canRotate(state, s);
  if (rot.ok && side.rotationSpent === 0 && best && best.action.type === 'skill') {
    for (const dir of [1, -1] as const) {
      const cost = rotationCost(side, 1);
      if (side.fp < cost + 30) continue;
      const trial = cloneState(state);
      try {
        applyAction(trial, s, { type: 'rotate', steps: 1, direction: dir });
      } catch {
        continue;
      }
      let improved = 0;
      for (const v of trial.sides[s].vivosaurs) {
        if (v.ko || v.acted) continue;
        for (const a of skillAvailability(trial, s, v.slot)) {
          if (!a.usable || a.skill.power === null) continue;
          for (const e of enemies) improved = Math.max(improved, attackScore(trial, s, v.slot, a.index, trial.sides[s === 0 ? 1 : 0].vivosaurs[e.slot], s === 0 ? 1 : 0) / (1 + a.skill.fp / 150));
        }
      }
      if (improved > best.score * 1.25) return { type: 'rotate', steps: 1, direction: dir };
    }
  }

  if (!best || best.score < 8) return { type: 'endTurn' };
  return best.action;
}

/** Runs the AI until it ends its turn (or the battle finishes). Returns all actions taken. */
export function playAiTurn(state: BattleState, s: SideIndex, maxActions = 12): BattleAction[] {
  const actions: BattleAction[] = [];
  for (let i = 0; i < maxActions && state.phase === 'active' && state.active === s; i++) {
    const action = chooseAction(state, s);
    try {
      applyAction(state, s, action);
      actions.push(action);
    } catch {
      applyAction(state, s, { type: 'endTurn' });
      actions.push({ type: 'endTurn' });
      break;
    }
    if (action.type === 'endTurn') break;
  }
  if (state.phase === 'active' && state.active === s) {
    applyAction(state, s, { type: 'endTurn' });
    actions.push({ type: 'endTurn' });
  }
  return actions;
}
