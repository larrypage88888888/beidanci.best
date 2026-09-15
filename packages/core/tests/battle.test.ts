import { describe, expect, it } from 'vitest';
import {
  BATTLE_QUESTION_COUNT,
  PLAYER_MAX_HP,
  battleOutcome,
  buildBattleWords,
  damageForCombo,
} from '../src/battle';

describe('damageForCombo', () => {
  it('连击伤害随连击递增，每 3 连 +1，封顶 +4', () => {
    expect(damageForCombo(1)).toBe(1);
    expect(damageForCombo(2)).toBe(1);
    expect(damageForCombo(3)).toBe(2);
    expect(damageForCombo(5)).toBe(2);
    expect(damageForCombo(6)).toBe(3);
    expect(damageForCombo(9)).toBe(4);
    expect(damageForCombo(12)).toBe(5);
    expect(damageForCombo(20)).toBe(5);
  });
});

describe('battleOutcome', () => {
  it('BOSS 血量归零 → 胜利', () => {
    expect(battleOutcome({ playerHp: 3, bossHp: 0, answered: 6, total: 10 })).toBe('win');
  });

  it('玩家血量归零 → 失败', () => {
    expect(battleOutcome({ playerHp: 0, bossHp: 4, answered: 5, total: 10 })).toBe('lose');
  });

  it('题答完未分胜负：玩家剩余血量多才赢', () => {
    expect(battleOutcome({ playerHp: 5, bossHp: 3, answered: 10, total: 10 })).toBe('win');
    expect(battleOutcome({ playerHp: 3, bossHp: 5, answered: 10, total: 10 })).toBe('lose');
    expect(battleOutcome({ playerHp: 3, bossHp: 3, answered: 10, total: 10 })).toBe('lose');
  });

  it('未打完且双方有血 → 继续', () => {
    expect(battleOutcome({ playerHp: 4, bossHp: 5, answered: 3, total: 10 })).toBeNull();
  });
});

describe('buildBattleWords', () => {
  const rng = () => 0.5;

  it('复习词优先，其次新词，去重', () => {
    const out = buildBattleWords({
      priority: ['a', 'b', 'a'],
      secondary: ['b', 'c'],
      fallback: ['d'],
      count: 4,
      rng,
    });
    expect(new Set(out).size).toBe(4);
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).toContain('d');
  });

  it('池不足时循环补齐到 count 题', () => {
    const out = buildBattleWords({
      priority: ['x'],
      secondary: [],
      fallback: [],
      count: BATTLE_QUESTION_COUNT,
      rng,
    });
    expect(out).toHaveLength(BATTLE_QUESTION_COUNT);
    expect(out.every((id) => id === 'x')).toBe(true);
  });

  it('空池返回空数组', () => {
    expect(buildBattleWords({ priority: [], secondary: [], fallback: [], count: 5, rng })).toEqual([]);
  });

  it('同一 seed 输出确定（同 rng 序列可复现）', () => {
    const a = buildBattleWords({ priority: ['a', 'b', 'c', 'd', 'e'], secondary: [], fallback: [], count: 5, rng });
    const b = buildBattleWords({ priority: ['a', 'b', 'c', 'd', 'e'], secondary: [], fallback: [], count: 5, rng });
    expect(a).toEqual(b);
  });
});

describe('常量', () => {
  it('一场 10 题、玩家 5 血', () => {
    expect(BATTLE_QUESTION_COUNT).toBe(10);
    expect(PLAYER_MAX_HP).toBe(5);
  });
});
