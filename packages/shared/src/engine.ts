/**
 * Fossil Fighters: Champions battle engine.
 *
 * Deterministic (seeded RNG), server-authoritative, and independent of any UI. Rules and numbers follow the
 * Fossil Fighters wiki and the competitive Fossil Fighters wiki's damage/accuracy formulas; places where the
 * exact in-game value is undocumented are called out in constants.ts.
 */
import {
  AUTO_COUNTER_FRACTION, AUTO_LP_RECOVERY_FRACTION, BERSERKER_LP_FRACTION, CHARGE_MULTIPLIER, CONFUSE_SKIP_CHANCE,
  COUNTER_CHANCE, CRIT_MULTIPLIER, DEFAULT_BATTLE_OPTIONS, ELEMENT_BEATS, ENFLAME_ATTACK, ENFLAME_DEFENSE, ENRAGE_ACCURACY,
  ENRAGE_ATTACK, FP_ABSORB_FRACTION, HARDEN_DEFENSE, HERO_LEVELS, INFECTION_TURNS, JURASSIC_SUPPORT_FACTOR, LINK_DEFAULT_CHANCE,
  PARTING_BLOW_LP_FRACTION, POISON_PERCENT, QUICKEN_SPEED_PERCENT, RANDOM_MULT_MAX, RANDOM_MULT_MIN, RANGE_MULTIPLIERS,
  RESURRECT_TURNS, ROTATION_FP_MAX, ROTATION_FP_PER_STEP, SCARE_SEALED, SLEEP_HITS, SOLO_POWER_ATTACK_MULT, STATUS_DURATION,
  SUPER_EXCITE_ROTATE_CHANCE, TEAM_SKILL_KO_PENALTY,
} from './constants.js';
import { findVivosaur, getVivosaur, isTeamCompatible } from './data/index.js';
import { FORMATION_ZONES, isAttackZone, isSupportZone, rotateZone, tileDistance, type Formation } from './field.js';
import { allSkillsUnlocked, statsAtRank, unlockedSkillCount } from './progression.js';
import { Rng } from './rng.js';
import type {
  AbilityType, BattleAction, BattleEvent, BattleOptions, BattleSide, BattleState, BattleVivosaur, SkillData, StatKey,
  StatusKind, StatusTier, TeamSetup, VivosaurData,
} from './types.js';

type SideIndex = 0 | 1;

const NEGATIVE_STATUSES: StatusKind[] = ['poison', 'sleep', 'scare', 'excite', 'confuse', 'enrage'];

export class BattleError extends Error {}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeVivosaur(member: TeamSetup['members'][number], slot: number, formation: Formation): BattleVivosaur {
  const species = getVivosaur(member.speciesId);
  return {
    slot,
    speciesId: species.id,
    baseSpeciesId: species.id,
    name: member.nickname || species.name,
    rank: member.rank,
    maxLp: member.stats.lp,
    lp: member.stats.lp,
    stats: { ...member.stats },
    crit: species.crit,
    zone: FORMATION_ZONES[formation][slot],
    statuses: [],
    sealed: [],
    sleepHits: 0,
    infection: 0,
    resurrectIn: 0,
    acted: false,
    ko: false,
    resurrected: false,
  };
}

export function createBattle(teams: [TeamSetup, TeamSetup], seed: number, options: Partial<BattleOptions> = {}): BattleState {
  const opts: BattleOptions = { ...DEFAULT_BATTLE_OPTIONS, ...options };
  const sides = teams.map((t) => {
    if (t.members.length < 1 || t.members.length > 3) throw new BattleError('A team needs 1 to 3 vivosaurs');
    const level = Math.min(20, Math.max(1, t.heroLevel ?? opts.heroLevel));
    const lv = HERO_LEVELS[level - 1];
    const side: BattleSide = {
      id: t.id,
      name: t.name,
      vivosaurs: t.members.map((m, i) => makeVivosaur(m, i, t.formation ?? 'cambrian')),
      fp: lv.start,
      fpGain: lv.gain,
      fpMax: lv.max,
      rotationSpent: 0,
      teamCompatible: t.members.length === 3 && isTeamCompatible(t.members.map((m) => m.speciesId)),
      heroLevel: level,
    };
    return side;
  }) as [BattleSide, BattleSide];

  const state: BattleState = {
    seed,
    rng: seed,
    options: opts,
    sides,
    active: 0,
    turn: 0,
    phase: 'active',
    winner: null,
    endReason: null,
    log: [],
  };
  const rng = new Rng(state.rng);
  const speeds: [number, number] = [teamSpeed(sides[0]), teamSpeed(sides[1])];
  let first: SideIndex = speeds[0] > speeds[1] ? 0 : speeds[1] > speeds[0] ? 1 : (rng.int(2) as SideIndex);
  state.active = first;
  state.log.push({ type: 'battleStart', first, speeds });

  // Start-of-battle abilities.
  for (const s of [0, 1] as SideIndex[]) {
    for (const v of sides[s].vivosaurs) {
      if (hasAbility(v, 'sleepy')) applyStatus(state, rng, s, v, 'sleep', 2, true);
      if (hasAbility(v, 'hardenPlus')) applyStatus(state, rng, s, v, 'harden', 1, true);
      if (hasAbility(v, 'counterPlus')) applyStatus(state, rng, s, v, 'counter', 1, true);
      if (hasAbility(v, 'quickenPlus')) applyStatus(state, rng, s, v, 'quicken', 1, true);
      if (hasAbility(v, 'enflamePlusS')) applyStatus(state, rng, s, v, 'enflame', 2, true);
    }
  }
  startTurn(state, rng, first);
  state.rng = rng.state;
  return state;
}

function teamSpeed(side: BattleSide): number {
  return side.vivosaurs.reduce((a, v) => a + v.stats.speed, 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function speciesOf(v: BattleVivosaur): VivosaurData {
  return getVivosaur(v.speciesId);
}

export function hasAbility(v: BattleVivosaur, type: AbilityType): boolean {
  return speciesOf(v).abilities.some((a) => a.type === type);
}

function abilityValue(v: BattleVivosaur, type: AbilityType): number | undefined {
  return speciesOf(v).abilities.find((a) => a.type === type)?.value;
}

export function getStatus(v: BattleVivosaur, kind: StatusKind): { kind: StatusKind; tier: StatusTier; turns: number } | undefined {
  return v.statuses.find((s) => s.kind === kind);
}

function alive(side: BattleSide): BattleVivosaur[] {
  return side.vivosaurs.filter((v) => !v.ko);
}

function other(s: SideIndex): SideIndex {
  return s === 0 ? 1 : 0;
}

/** Skills available at this vivosaur's rank: the first four unlock at ranks 1/4/8/12, the rest (team skill included) at rank 16. */
export function availableSkills(v: BattleVivosaur): SkillData[] {
  const species = speciesOf(v);
  if (allSkillsUnlocked(v.rank)) return species.skills;
  const regular = species.skills.filter((s) => s.kind !== 'team');
  return regular.slice(0, unlockedSkillCount(v.rank));
}

function skillIndex(v: BattleVivosaur, skill: SkillData): number {
  return speciesOf(v).skills.indexOf(skill);
}

/**
 * Support effect percentage applied to a stat of `target` (which is on side `s`).
 * Own SZ vivosaurs with "own AZ" effects and enemy SZ vivosaurs with "enemy AZ" effects both apply to AZ vivosaurs.
 * The effect is halved when the receiving side has two vivosaurs in the AZ (Jurassic formation).
 */
export function supportPercent(state: BattleState, s: SideIndex, target: BattleVivosaur, stat: StatKey): number {
  if (!isAttackZone(target.zone) || target.ko) return 0;
  const side = state.sides[s];
  const azCount = alive(side).filter((v) => isAttackZone(v.zone)).length;
  const factor = azCount >= 2 ? JURASSIC_SUPPORT_FACTOR : 1;
  let total = 0;
  for (const v of alive(side)) {
    if (v === target || !isSupportZone(v.zone)) continue;
    const sup = speciesOf(v).support;
    if (sup && sup.target === 'own') total += sup[stat] ?? 0;
  }
  for (const v of alive(state.sides[other(s)])) {
    if (!isSupportZone(v.zone)) continue;
    const sup = speciesOf(v).support;
    if (sup && sup.target === 'enemy') total += sup[stat] ?? 0;
  }
  return total * factor;
}

function partingBlowActive(v: BattleVivosaur): boolean {
  return hasAbility(v, 'partingBlow') && v.lp > 0 && v.lp <= v.maxLp * PARTING_BLOW_LP_FRACTION;
}

function partingBlow(v: BattleVivosaur): { atkAcc: number; defSpd: number } {
  if (!partingBlowActive(v)) return { atkAcc: 1, defSpd: 1 };
  return speciesOf(v).partingBlow ?? { atkAcc: 2, defSpd: 1 };
}

/** Effective accuracy after support, Enrage and Parting Blow. */
export function effectiveAccuracy(state: BattleState, s: SideIndex, v: BattleVivosaur): number {
  const enrage = getStatus(v, 'enrage');
  let acc = v.stats.accuracy * (1 + supportPercent(state, s, v, 'accuracy') / 100);
  if (enrage) acc -= ENRAGE_ACCURACY[enrage.tier];
  acc *= partingBlow(v).atkAcc;
  return Math.max(0, acc);
}

/** Effective speed (evasion) after support, Quicken, Sleep and Parting Blow. */
export function effectiveSpeed(state: BattleState, s: SideIndex, v: BattleVivosaur): number {
  if (getStatus(v, 'sleep')) return 0;
  const quicken = getStatus(v, 'quicken');
  let spd = v.stats.speed * (1 + supportPercent(state, s, v, 'speed') / 100);
  if (quicken) spd *= 1 + QUICKEN_SPEED_PERCENT[quicken.tier] / 100;
  spd *= partingBlow(v).defSpd;
  return Math.max(0, spd);
}

function elementalBoostCount(state: BattleState): number {
  let n = 0;
  for (const side of state.sides) for (const v of alive(side)) if (hasAbility(v, 'elementalBoost')) n++;
  return n;
}

export function elementMultiplier(state: BattleState, attacker: VivosaurData, defender: VivosaurData): number {
  const boosts = elementalBoostCount(state);
  if (ELEMENT_BEATS[attacker.element] === defender.element) return boosts >= 2 ? 3 : boosts === 1 ? 2 : 1.5;
  if (ELEMENT_BEATS[defender.element] === attacker.element) return boosts >= 1 ? 0.5 : 1;
  return 1;
}

/** Range multiplier by tile distance. Uses the vivosaur's own table from the game data when present (80 = 1.0). */
export function rangeMultiplier(attacker: BattleVivosaur, target: BattleVivosaur): number {
  const d = tileDistance(attacker.zone, target.zone);
  const species = speciesOf(attacker);
  if (species.rangeTable && species.rangeTable.length >= 8) return species.rangeTable[d] / 80;
  return RANGE_MULTIPLIERS[species.range][d];
}

export interface DamagePreview {
  min: number;
  max: number;
  elementMult: number;
  rangeMult: number;
  distance: number;
}

/**
 * Damage = {[(Attack + Base Power + status) * atkSupport] - (Defense * defSupport + status)} * random * element * range * crit * partingBlow * charge
 * Base power is the skill's listed power minus the species' max-rank Attack.
 */
function computeDamage(
  state: BattleState, as: SideIndex, attacker: BattleVivosaur, skill: SkillData, ds: SideIndex, defender: BattleVivosaur,
  randomMult: number, crit: boolean, opts: { team?: boolean; extraPower?: number } = {},
): { damage: number; elementMult: number; rangeMult: number } {
  const aSpecies = speciesOf(attacker);
  const dSpecies = speciesOf(defender);
  let basePower = (skill.basePower ?? (skill.power ?? 0) - aSpecies.stats.attack) + (opts.extraPower ?? 0);
  if (opts.team) {
    const kos = state.sides[as].vivosaurs.filter((v) => v.ko).length;
    basePower = basePower * (1 - TEAM_SKILL_KO_PENALTY * kos);
  }
  const enflameA = getStatus(attacker, 'enflame');
  const enrageA = getStatus(attacker, 'enrage');
  let atk = attacker.stats.attack + basePower;
  if (enflameA) atk += ENFLAME_ATTACK[enflameA.tier];
  if (enrageA) atk += ENRAGE_ATTACK[enrageA.tier];
  atk *= 1 + supportPercent(state, as, attacker, 'attack') / 100;
  if (hasAbility(attacker, 'soloPower') && alive(state.sides[as]).length === 1) atk *= SOLO_POWER_ATTACK_MULT;

  let def = defender.stats.defense * (1 + supportPercent(state, ds, defender, 'defense') / 100);
  def *= partingBlow(defender).defSpd;
  const hardenD = getStatus(defender, 'harden');
  const enflameD = getStatus(defender, 'enflame');
  if (hardenD) def += HARDEN_DEFENSE[hardenD.tier];
  if (enflameD) def -= ENFLAME_DEFENSE[enflameD.tier];

  const elementMult = elementMultiplier(state, aSpecies, dSpecies);
  const rangeMult = rangeMultiplier(attacker, defender);
  let dmg = Math.max(0, atk - def) * randomMult * elementMult * rangeMult;
  if (crit) dmg *= CRIT_MULTIPLIER;
  dmg *= partingBlow(attacker).atkAcc;
  if (getStatus(attacker, 'charge')) dmg *= CHARGE_MULTIPLIER;
  return { damage: Math.max(1, Math.floor(dmg)), elementMult, rangeMult };
}

/** Damage range shown in the UI before committing to an attack. */
export function previewDamage(state: BattleState, as: SideIndex, slot: number, skillIdx: number, target: { side: SideIndex; slot: number }): DamagePreview | null {
  const attacker = state.sides[as].vivosaurs[slot];
  const skill = speciesOf(attacker).skills[skillIdx];
  const defender = state.sides[target.side].vivosaurs[target.slot];
  if (!attacker || !skill || !defender || skill.power === null) return null;
  const team = skill.kind === 'team';
  const lo = computeDamage(state, as, attacker, skill, target.side, defender, RANDOM_MULT_MIN, false, { team });
  const hi = computeDamage(state, as, attacker, skill, target.side, defender, RANDOM_MULT_MAX, false, { team });
  return { min: lo.damage, max: hi.damage, elementMult: lo.elementMult, rangeMult: lo.rangeMult, distance: tileDistance(attacker.zone, defender.zone) };
}

// ---------------------------------------------------------------------------
// Status handling
// ---------------------------------------------------------------------------

function immune(v: BattleVivosaur, kind: StatusKind): boolean {
  const groups = speciesOf(v).groups;
  const boney = groups.includes(22);
  const zombie = groups.includes(23) || v.speciesId === 'zongazonga';
  if (boney && (kind === 'poison' || kind === 'scare')) return true;
  if (zombie && (kind === 'sleep' || kind === 'scare' || kind === 'infection')) return true;
  return false;
}

function applyStatus(state: BattleState, rng: Rng, s: SideIndex, v: BattleVivosaur, kind: StatusKind, tier: StatusTier, silent = false): boolean {
  if (v.ko || immune(v, kind)) {
    if (!silent) state.log.push({ type: 'status', side: s, slot: v.slot, status: kind, tier, applied: false });
    return false;
  }
  const existing = getStatus(v, kind);
  const duration = STATUS_DURATION[kind];
  if (existing) {
    existing.tier = Math.max(existing.tier, tier) as StatusTier;
    existing.turns = duration; // turns do not stack
  } else {
    v.statuses.push({ kind, tier, turns: duration });
  }
  const t = getStatus(v, kind)!.tier;
  if (kind === 'sleep') v.sleepHits = SLEEP_HITS[t];
  if (kind === 'infection') v.infection = INFECTION_TURNS;
  if (kind === 'scare') {
    const avail = availableSkills(v).map((sk) => skillIndex(v, sk));
    const sealed: number[] = [];
    const pool = [...avail];
    while (sealed.length < SCARE_SEALED[Math.min(2, t)] && pool.length) {
      const i = rng.int(pool.length);
      sealed.push(pool[i]);
      pool.splice(i, 1);
    }
    v.sealed = sealed;
  }
  if (!silent) state.log.push({ type: 'status', side: s, slot: v.slot, status: kind, tier: t, applied: true });
  return true;
}

function removeStatus(v: BattleVivosaur, kind: StatusKind) {
  v.statuses = v.statuses.filter((st) => st.kind !== kind);
  if (kind === 'sleep') v.sleepHits = 0;
  if (kind === 'scare') v.sealed = [];
}

function cure(state: BattleState, s: SideIndex, v: BattleVivosaur) {
  for (const kind of NEGATIVE_STATUSES) removeStatus(v, kind);
  state.log.push({ type: 'cure', side: s, slot: v.slot });
}

// ---------------------------------------------------------------------------
// Damage application, KO, win
// ---------------------------------------------------------------------------

function dealDamage(state: BattleState, rng: Rng, s: SideIndex, v: BattleVivosaur, amount: number, source: Extract<BattleEvent, { type: 'damage' }>['source'], extra: Partial<Extract<BattleEvent, { type: 'damage' }>> = {}) {
  if (v.ko) return;
  const dmg = Math.max(0, Math.min(v.lp, Math.floor(amount)));
  v.lp -= dmg;
  state.log.push({ type: 'damage', side: s, slot: v.slot, amount: dmg, crit: false, elementMult: 1, rangeMult: 1, countered: false, source, ...extra });
  if (v.lp <= 0) knockOut(state, s, v);
  else if (hasAbility(v, 'berserker') && v.lp <= v.maxLp * BERSERKER_LP_FRACTION && !getStatus(v, 'confuse')) {
    applyStatus(state, rng, s, v, 'confuse', 1);
  }
}

function knockOut(state: BattleState, s: SideIndex, v: BattleVivosaur) {
  v.lp = 0;
  v.ko = true;
  v.statuses = [];
  v.sealed = [];
  v.sleepHits = 0;
  v.infection = 0;
  if (hasAbility(v, 'resurrect') && !v.resurrected) v.resurrectIn = RESURRECT_TURNS;
  state.log.push({ type: 'ko', side: s, slot: v.slot });
}

function heal(state: BattleState, s: SideIndex, v: BattleVivosaur, amount: number, source: string) {
  if (v.ko) return 0;
  const h = Math.max(0, Math.min(Math.floor(amount), v.maxLp - v.lp));
  v.lp += h;
  state.log.push({ type: 'heal', side: s, slot: v.slot, amount: h, source });
  return h;
}

function gainFp(state: BattleState, s: SideIndex, amount: number, source: string) {
  const side = state.sides[s];
  const a = Math.max(0, Math.min(Math.floor(amount), side.fpMax - side.fp));
  if (a === 0) return;
  side.fp += a;
  state.log.push({ type: 'fp', side: s, amount: a, source });
}

function checkEnd(state: BattleState): boolean {
  if (state.phase === 'finished') return true;
  const dead = [0, 1].map((i) => alive(state.sides[i]).length === 0);
  if (dead[0] || dead[1]) {
    state.phase = 'finished';
    state.winner = dead[0] && dead[1] ? null : dead[0] ? 1 : 0;
    state.endReason = 'knockout';
    state.log.push({ type: 'battleEnd', winner: state.winner, reason: 'knockout' });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

function rotateSide(state: BattleState, s: SideIndex, steps: number, cause: 'manual' | 'skill' | 'excite', fpCost = 0) {
  for (const v of state.sides[s].vivosaurs) v.zone = rotateZone(v.zone, steps);
  state.log.push({ type: 'rotate', side: s, steps, cause, fpCost });
}

export function rotationCost(side: BattleSide, steps: number): number {
  const total = Math.min(ROTATION_FP_MAX, side.rotationSpent + ROTATION_FP_PER_STEP * Math.abs(steps));
  return Math.max(0, total - side.rotationSpent);
}

export function canRotate(state: BattleState, s: SideIndex): { ok: boolean; reason?: string } {
  if (state.phase !== 'active') return { ok: false, reason: 'Battle is over' };
  if (state.active !== s) return { ok: false, reason: 'Not your turn' };
  if (alive(state.sides[s]).some((v) => getStatus(v, 'excite'))) return { ok: false, reason: 'Excite prevents rotation' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SkillAvailability {
  index: number;
  skill: SkillData;
  usable: boolean;
  reason?: string;
}

export function skillAvailability(state: BattleState, s: SideIndex, slot: number): SkillAvailability[] {
  const side = state.sides[s];
  const v = side.vivosaurs[slot];
  const species = speciesOf(v);
  const avail = availableSkills(v);
  return species.skills.map((skill, index) => {
    let reason: string | undefined;
    if (v.ko) reason = 'Knocked out';
    else if (!avail.includes(skill)) reason = 'Locked until a higher rank';
    else if (v.acted) reason = 'Already acted this turn';
    else if (getStatus(v, 'sleep')) reason = 'Asleep';
    else if (v.sealed.includes(index)) reason = 'Sealed by Scare';
    else if (skill.kind === 'team' && !side.teamCompatible) reason = 'Team is not compatible';
    else if (side.fp < skill.fp) reason = 'Not enough FP';
    return { index, skill, usable: !reason, reason };
  });
}

function resolveTargets(state: BattleState, s: SideIndex, user: BattleVivosaur, skill: SkillData, target?: { side: SideIndex; slot: number }): BattleVivosaur[] {
  const own = state.sides[s];
  const enemy = state.sides[other(s)];
  switch (skill.target) {
    case 'allEnemies':
      return alive(enemy);
    case 'allAllies':
      return alive(own);
    case 'self':
      return [user];
    case 'none':
      return [];
    case 'enemy': {
      if (!target || target.side !== other(s)) throw new BattleError('Choose an enemy target');
      const t = enemy.vivosaurs[target.slot];
      if (!t || t.ko) throw new BattleError('Target is not available');
      return [t];
    }
    case 'ally': {
      const t = target ? state.sides[target.side]?.vivosaurs[target.slot] : user;
      if (!t || t.ko) throw new BattleError('Target is not available');
      if (target && target.side !== s) throw new BattleError('Choose an ally');
      if (skill.effects.some((e) => e.type === 'lawOfTheJungle') && t === user) throw new BattleError('Choose a different ally');
      return [t];
    }
  }
}

/** Core attack resolution for one target. Returns damage dealt (0 on miss/counter). */
function resolveAttack(
  state: BattleState, rng: Rng, as: SideIndex, attacker: BattleVivosaur, skill: SkillData, ds: SideIndex, defender: BattleVivosaur,
  opts: { team: boolean; link?: boolean; extraPower?: number },
): number {
  if (defender.ko || attacker.ko) return 0;
  // Accuracy: (Accuracy * mods) - (Speed * mods * rand(0.5..1)) > 0 hits.
  const acc = effectiveAccuracy(state, as, attacker);
  const spd = effectiveSpeed(state, ds, defender);
  const hit = acc - spd * rng.range(0.5, 1) > 0;
  if (!hit) {
    state.log.push({ type: 'miss', side: ds, slot: defender.slot });
    return 0;
  }
  const crit = !opts.team && rng.chance(attacker.crit);
  const randomMult = rng.range(RANDOM_MULT_MIN, RANDOM_MULT_MAX);
  const { damage, elementMult, rangeMult } = computeDamage(state, as, attacker, skill, ds, defender, randomMult, crit, opts);

  // Counter status reflects the damage back to the attacker.
  const counter = getStatus(defender, 'counter');
  if (counter && skill.counterable && rng.chance(COUNTER_CHANCE[counter.tier])) {
    dealDamage(state, rng, as, attacker, damage, 'counter', { crit, elementMult, rangeMult, countered: true });
    return 0;
  }
  dealDamage(state, rng, ds, defender, damage, 'skill', { crit, elementMult, rangeMult });

  if (!defender.ko && skill.counterable && hasAbility(defender, 'autoCounter')) {
    dealDamage(state, rng, as, attacker, Math.floor(damage * AUTO_COUNTER_FRACTION), 'autoCounter');
  }
  if (hasAbility(defender, 'fpAbsorb') && !opts.link) gainFp(state, ds, skill.fp * FP_ABSORB_FRACTION, 'FP Absorb');
  if (!defender.ko && getStatus(defender, 'sleep')) {
    defender.sleepHits -= 1;
    if (defender.sleepHits <= 0) {
      removeStatus(defender, 'sleep');
      state.log.push({ type: 'wake', side: ds, slot: defender.slot });
    }
  }
  return damage;
}

function useSkill(state: BattleState, rng: Rng, s: SideIndex, slot: number, skillIdx: number, target?: { side: SideIndex; slot: number }) {
  const side = state.sides[s];
  const user = side.vivosaurs[slot];
  if (!user) throw new BattleError('No such vivosaur');
  const avail = skillAvailability(state, s, slot)[skillIdx];
  if (!avail) throw new BattleError('No such skill');
  if (!avail.usable) throw new BattleError(avail.reason ?? 'Skill unavailable');
  const skill = avail.skill;
  const targets = resolveTargets(state, s, user, skill, target);
  if (skill.target === 'enemy' || skill.target === 'ally') if (targets.length === 0) throw new BattleError('No target');

  side.fp -= skill.fp;
  side.rotationSpent = 0;
  user.acted = true;
  state.log.push({ type: 'skill', side: s, slot, skillId: skill.id, skillName: skill.name, fpCost: skill.fp, targets: targets.map((t) => ({ side: (state.sides[s].vivosaurs.includes(t) ? s : other(s)) as SideIndex, slot: t.slot })) });

  performSkill(state, rng, s, user, skill, targets, { link: false });

  // Link: after an AZ vivosaur attacks, SZ allies with Link may use their weakest attack for free.
  if (skill.power !== null && isAttackZone(user.zone) && state.phase === 'active') {
    const primary = targets.find((t) => !state.sides[s].vivosaurs.includes(t));
    if (primary) {
      for (const ally of alive(side)) {
        if (ally === user || !isSupportZone(ally.zone) || !hasAbility(ally, 'link') || getStatus(ally, 'sleep')) continue;
        if (!rng.chance(abilityValue(ally, 'link') ?? LINK_DEFAULT_CHANCE)) continue;
        const attacks = availableSkills(ally).filter((sk) => sk.power !== null && sk.kind !== 'team' && !ally.sealed.includes(skillIndex(ally, sk)));
        if (!attacks.length) continue;
        const weakest = attacks.reduce((a, b) => ((a.power ?? 0) <= (b.power ?? 0) ? a : b));
        if (primary.ko) break;
        state.log.push({ type: 'link', side: s, slot: ally.slot });
        state.log.push({ type: 'skill', side: s, slot: ally.slot, skillId: weakest.id, skillName: weakest.name, fpCost: 0, targets: [{ side: other(s), slot: primary.slot }] });
        resolveAttack(state, rng, s, ally, weakest, other(s), primary, { team: false, link: true });
        if (checkEnd(state)) break;
      }
    }
  }
  checkEnd(state);
}

function performSkill(state: BattleState, rng: Rng, s: SideIndex, user: BattleVivosaur, skill: SkillData, targets: BattleVivosaur[], opts: { link: boolean }) {
  const enemySide = other(s);
  const team = skill.kind === 'team';
  let extraPower = 0;
  if (skill.effects.some((e) => e.type === 'spite')) {
    extraPower = Math.max(0, user.lp - 1);
    user.lp = 1;
    state.log.push({ type: 'damage', side: s, slot: user.slot, amount: extraPower, crit: false, elementMult: 1, rangeMult: 1, countered: false, source: 'spite' });
  }
  const damaging = skill.power !== null;
  const dealt = new Map<BattleVivosaur, number>();
  const multi = skill.effects.find((e) => e.type === 'multiHit');
  if (damaging && multi && multi.type === 'multiHit') {
    // Several weaker hits against random living enemies; each hit carries 1/hits of the base power.
    const perHit = -(skill.basePower ?? (skill.power ?? 0) - speciesOf(user).stats.attack) * (1 - 1 / multi.hits);
    for (let i = 0; i < multi.hits; i++) {
      const pool = alive(state.sides[enemySide]);
      if (!pool.length || state.phase !== 'active') break;
      const t = rng.pick(pool);
      const dmg = resolveAttack(state, rng, s, user, skill, enemySide, t, { team, link: opts.link, extraPower: extraPower + perHit });
      dealt.set(t, (dealt.get(t) ?? 0) + dmg);
    }
  } else if (damaging) {
    for (const t of targets) {
      if (state.phase !== 'active') break;
      const ts = state.sides[s].vivosaurs.includes(t) ? s : enemySide;
      const dmg = resolveAttack(state, rng, s, user, skill, ts, t, { team, link: opts.link, extraPower });
      dealt.set(t, dmg);
    }
  }
  for (const effect of skill.effects) {
    if (state.phase !== 'active') break;
    switch (effect.type) {
      case 'status': {
        if (effect.target === 'hit') {
          for (const t of targets) {
            if (t.ko) continue;
            if (damaging && (dealt.get(t) ?? 0) <= 0) continue; // missed or countered
            const ts = state.sides[s].vivosaurs.includes(t) ? s : enemySide;
            if (rng.chance(effect.chance)) applyStatus(state, rng, ts, t, effect.status, effect.tier);
            else state.log.push({ type: 'status', side: ts, slot: t.slot, status: effect.status, tier: effect.tier, applied: false });
          }
        } else if (effect.target === 'self') {
          applyStatus(state, rng, s, user, effect.status, effect.tier);
        } else {
          for (const t of targets) applyStatus(state, rng, s, t, effect.status, effect.tier);
        }
        break;
      }
      case 'rotate': {
        const victims = targets.filter((t) => !state.sides[s].vivosaurs.includes(t) && (dealt.get(t) ?? 0) > 0);
        if (victims.length && rng.chance(effect.chance)) {
          if (alive(state.sides[enemySide]).some((v) => hasAbility(v, 'positionLock'))) break;
          rotateSide(state, enemySide, rng.int(2) === 0 ? 1 : -1, 'skill');
        }
        break;
      }
      case 'heal':
        for (const t of targets) heal(state, s, t, effect.amount, skill.name);
        break;
      case 'cure':
        for (const t of targets) cure(state, s, t);
        break;
      case 'lawOfTheJungle': {
        const ally = targets[0];
        if (ally && ally !== user && !ally.ko) {
          const amount = Math.max(0, ally.lp - 1);
          ally.lp = 1;
          state.log.push({ type: 'damage', side: s, slot: ally.slot, amount, crit: false, elementMult: 1, rangeMult: 1, countered: false, source: 'lawOfTheJungle' });
          heal(state, s, user, amount, skill.name);
        }
        break;
      }
      case 'sacrifice': {
        const allies = alive(state.sides[s]).filter((v) => v !== user);
        if (!allies.length) break;
        const pool = Math.max(0, user.lp - 1);
        user.lp = 1;
        state.log.push({ type: 'damage', side: s, slot: user.slot, amount: pool, crit: false, elementMult: 1, rangeMult: 1, countered: false, source: 'sacrifice' });
        const each = Math.floor(pool / allies.length);
        for (const a of allies) heal(state, s, a, each, skill.name);
        break;
      }
      case 'equalizeFP': {
        const a = state.sides[0], b = state.sides[1];
        const avg = Math.floor((a.fp + b.fp) / 2);
        a.fp = Math.min(a.fpMax, avg);
        b.fp = Math.min(b.fpMax, avg);
        state.log.push({ type: 'fp', side: s, amount: 0, source: skill.name });
        break;
      }
      case 'stealFP': {
        if (rng.chance(effect.chance)) {
          const enemy = state.sides[enemySide];
          const amount = Math.min(effect.amount, enemy.fp);
          enemy.fp -= amount;
          state.log.push({ type: 'fp', side: enemySide, amount: -amount, source: skill.name });
          gainFp(state, s, amount, skill.name);
        }
        break;
      }
      case 'drain': {
        let total = 0;
        for (const d of dealt.values()) total += d;
        if (total > 0) heal(state, s, user, total, skill.name);
        break;
      }
      case 'spite':
        break;
      case 'transform': {
        const choices = effect.into.filter((id) => findVivosaur(id));
        if (!choices.length) break;
        transform(state, s, user, rng.pick(choices));
        break;
      }
      case 'randomBuff': {
        const kind = rng.pick<StatusKind>(['enflame', 'harden', 'quicken']);
        for (const t of targets) applyStatus(state, rng, s, t, kind, 1);
        break;
      }
      case 'randomStatus': {
        for (const t of targets) {
          if (t.ko || (damaging && (dealt.get(t) ?? 0) <= 0)) continue;
          const ts = state.sides[s].vivosaurs.includes(t) ? s : enemySide;
          const kind = rng.pick<StatusKind>(['poison', 'sleep', 'scare', 'excite', 'confuse', 'enrage']);
          const tier = (rng.int(2) + 1) as StatusTier;
          applyStatus(state, rng, ts, t, kind, kind === 'poison' && rng.chance(20) ? 3 : tier);
        }
        break;
      }
      case 'instantKO': {
        for (const t of targets) {
          if (t.ko || (dealt.get(t) ?? 0) <= 0) continue;
          if (t.speciesId === 'zongazonga') continue; // immune to one-hit KO skills
          if (rng.chance(effect.chance)) {
            const ts = state.sides[s].vivosaurs.includes(t) ? s : enemySide;
            state.log.push({ type: 'damage', side: ts, slot: t.slot, amount: t.lp, crit: false, elementMult: 1, rangeMult: 1, countered: false, source: 'skill' });
            knockOut(state, ts, t);
          }
        }
        break;
      }
      case 'multiHit':
        break; // handled before damage resolution
    }
  }
  if (getStatus(user, 'charge') && damaging) removeStatus(user, 'charge');
  checkEnd(state);
}

function transform(state: BattleState, s: SideIndex, v: BattleVivosaur, into: string) {
  const from = v.speciesId;
  const species = getVivosaur(into);
  v.speciesId = species.id;
  v.name = species.name;
  v.crit = species.crit;
  v.stats = statsAtRank(species, v.rank);
  v.maxLp = v.stats.lp;
  v.lp = v.maxLp; // Transformation restores the new form's full LP.
  v.sealed = [];
  state.log.push({ type: 'transform', side: s, slot: v.slot, from, to: into });
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function startTurn(state: BattleState, rng: Rng, s: SideIndex) {
  const side = state.sides[s];
  state.active = s;
  state.turn += 1;
  side.rotationSpent = 0;
  for (const v of side.vivosaurs) v.acted = false;

  let gain = side.fpGain;
  for (const v of alive(side)) if (hasAbility(v, 'fpPlus')) gain += side.fpGain * ((abilityValue(v, 'fpPlus') ?? 10) / 100);
  gain = Math.floor(gain);
  const before = side.fp;
  side.fp = Math.min(side.fpMax, side.fp + gain);
  state.log.push({ type: 'turnStart', side: s, turn: state.turn, fp: side.fp, fpGained: side.fp - before });

  // Resurrect
  for (const v of side.vivosaurs) {
    if (v.ko && v.resurrectIn > 0) {
      v.resurrectIn -= 1;
      if (v.resurrectIn === 0 && alive(side).length > 0) {
        v.ko = false;
        v.resurrected = true;
        v.lp = Math.floor(v.maxLp / 2);
        state.log.push({ type: 'resurrect', side: s, slot: v.slot });
      }
    }
  }
  // Infection
  for (const v of alive(side)) {
    if (v.infection > 0) {
      v.infection -= 1;
      const st = getStatus(v, 'infection');
      if (st) st.turns = v.infection;
      if (v.infection <= 0) {
        state.log.push({ type: 'damage', side: s, slot: v.slot, amount: v.lp, crit: false, elementMult: 1, rangeMult: 1, countered: false, source: 'infection' });
        knockOut(state, s, v);
      }
    }
  }
  if (checkEnd(state)) return;
  // Auto LP Recovery
  for (const v of alive(side)) if (hasAbility(v, 'autoLpRecovery')) heal(state, s, v, v.maxLp * AUTO_LP_RECOVERY_FRACTION, 'Auto LP Recovery');
  // Super Excite may spin the team.
  if (alive(side).some((v) => getStatus(v, 'excite')?.tier === 2) && rng.chance(SUPER_EXCITE_ROTATE_CHANCE)) {
    rotateSide(state, s, rng.int(2) === 0 ? 1 : -1, 'excite');
  }
  // Confused vivosaurs act immediately.
  for (const v of alive(side)) {
    const conf = getStatus(v, 'confuse');
    if (!conf || getStatus(v, 'sleep') || v.acted) continue;
    const usable = skillAvailability(state, s, v.slot).filter((a) => a.usable && a.skill.power !== null && a.skill.kind !== 'team');
    if (!usable.length || rng.chance(CONFUSE_SKIP_CHANCE)) {
      state.log.push({ type: 'confused', side: s, slot: v.slot, acted: false });
      v.acted = true;
      continue;
    }
    const pick = rng.pick(usable);
    const pool: { side: SideIndex; slot: number }[] = [];
    for (const e of alive(state.sides[other(s)])) pool.push({ side: other(s), slot: e.slot });
    if (conf.tier >= 2) for (const a of alive(side)) pool.push({ side: s, slot: a.slot });
    const tgt = rng.pick(pool);
    state.log.push({ type: 'confused', side: s, slot: v.slot, acted: true });
    const skill = pick.skill;
    side.fp -= skill.fp;
    v.acted = true;
    const targets = skill.target === 'allEnemies' ? alive(state.sides[tgt.side]) : [state.sides[tgt.side].vivosaurs[tgt.slot]];
    state.log.push({ type: 'skill', side: s, slot: v.slot, skillId: skill.id, skillName: skill.name, fpCost: skill.fp, targets: targets.map((t) => ({ side: tgt.side, slot: t.slot })) });
    performSkill(state, rng, s, v, skill, targets, { link: false });
    if (state.phase !== 'active') return;
  }
}

function endTurn(state: BattleState, rng: Rng, s: SideIndex) {
  const side = state.sides[s];
  state.log.push({ type: 'turnEnd', side: s });
  for (const v of alive(side)) {
    const poison = getStatus(v, 'poison');
    if (poison) dealDamage(state, rng, s, v, Math.floor((v.maxLp * POISON_PERCENT[poison.tier]) / 100), 'poison');
  }
  for (const v of alive(side)) {
    for (const st of [...v.statuses]) {
      if (st.kind === 'infection') continue;
      st.turns -= 1;
      if (st.turns <= 0) {
        removeStatus(v, st.kind);
        state.log.push({ type: 'statusExpired', side: s, slot: v.slot, status: st.kind });
      }
    }
  }
  if (checkEnd(state)) return;
  if (state.turn >= state.options.maxTurns) {
    state.phase = 'finished';
    state.winner = null;
    state.endReason = 'turn limit';
    state.log.push({ type: 'battleEnd', winner: null, reason: 'turn limit' });
    return;
  }
  startTurn(state, rng, other(s));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Applies an action for `s`, mutating `state`. Returns the events produced. Throws BattleError on illegal input. */
export function applyAction(state: BattleState, s: SideIndex, action: BattleAction): BattleEvent[] {
  if (state.phase !== 'active') throw new BattleError('The battle is over');
  if (action.type === 'forfeit') {
    state.phase = 'finished';
    state.winner = other(s);
    state.endReason = 'forfeit';
    state.log.push({ type: 'forfeit', side: s });
    state.log.push({ type: 'battleEnd', winner: state.winner, reason: 'forfeit' });
    return state.log.slice(-2);
  }
  if (state.active !== s) throw new BattleError('Not your turn');
  const start = state.log.length;
  const rng = new Rng(state.rng);
  try {
    switch (action.type) {
      case 'skill':
        useSkill(state, rng, s, action.slot, action.skill, action.target as { side: SideIndex; slot: number } | undefined);
        break;
      case 'rotate': {
        const ok = canRotate(state, s);
        if (!ok.ok) throw new BattleError(ok.reason!);
        const steps = Math.max(1, Math.min(3, action.steps)) * (action.direction < 0 ? -1 : 1);
        const cost = rotationCost(state.sides[s], steps);
        if (state.sides[s].fp < cost) throw new BattleError('Not enough FP to rotate');
        state.sides[s].fp -= cost;
        state.sides[s].rotationSpent += cost;
        rotateSide(state, s, steps, 'manual', cost);
        break;
      }
      case 'endTurn':
        endTurn(state, rng, s);
        break;
      default:
        throw new BattleError('Unknown action');
    }
  } finally {
    state.rng = rng.state;
  }
  return state.log.slice(start);
}

/** Deep-copies a battle state (states are plain JSON). */
export function cloneState(state: BattleState): BattleState {
  return JSON.parse(JSON.stringify(state)) as BattleState;
}
