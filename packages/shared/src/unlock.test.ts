import { describe, expect, it } from 'vitest';
import { availableSkills, createBattle } from './engine.js';
import { memberAtRank } from './progression.js';

function skillsAt(rank: number) {
  const st = createBattle([{ id: 'a', name: 'A', members: [memberAtRank('t_rex', rank)] }, { id: 'b', name: 'B', members: [memberAtRank('allo', 20)] }], 1);
  return availableSkills(st.sides[0].vivosaurs[0]);
}

describe('skill unlocks', () => {
  it('unlocks one skill at ranks 1, 5, 10 and 15 and everything at 20', () => {
    expect(skillsAt(1).length).toBe(1);
    expect(skillsAt(4).length).toBe(1);
    expect(skillsAt(5).length).toBe(2);
    expect(skillsAt(10).length).toBe(3);
    expect(skillsAt(15).length).toBe(4);
    expect(skillsAt(19).some((s) => s.kind === 'team')).toBe(false);
    const all = skillsAt(20);
    expect(all.some((s) => s.kind === 'team')).toBe(true);
    expect(all.length).toBe(5);
  });
});
