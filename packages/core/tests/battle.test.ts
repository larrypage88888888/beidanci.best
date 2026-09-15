import { describe, expect, it } from 'vitest';
import {
  BATTLE_QUESTION_COUNT,
  CARD_COST,
  HERO_MAX_HP,
  MAX_MANA,
  battleOutcome,
  buildBattleWords,
  buildHand,
  cardStats,
  damageForCombo,
  opponentThreat,
  summonDamage,
} from '../src/battle';

describe('damageForCombo（旧规则保留兼容）', () => {
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
    expect(battleOutcome({ playerHp: 30, bossHp: 0, answered: 6, total: 10 })).toBe('win');
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

describe('cardStats（词卡属性：费用/ATK/HP/词根技能）', () => {
  it('费用按稀有度：SR=1 SSR=2 UR=3', () => {
    expect(CARD_COST.SR).toBe(1);
    expect(CARD_COST.SSR).toBe(2);
    expect(CARD_COST.UR).toBe(3);
  });

  it('ATK 随难度递增：floor(难度/10)+1，夹 3..10', () => {
    expect(cardStats({ difficulty: 40, rarity: 'SR' }).atk).toBe(5);
    expect(cardStats({ difficulty: 70, rarity: 'SSR' }).atk).toBe(8);
    expect(cardStats({ difficulty: 88, rarity: 'UR' }).atk).toBe(9);
    expect(cardStats({ difficulty: 5, rarity: 'SR' }).atk).toBe(3); // 下限
    expect(cardStats({ difficulty: 120, rarity: 'UR' }).atk).toBe(10); // 上限
    expect(cardStats({ difficulty: null, rarity: 'SR' }).atk).toBe(5); // 缺省按 40
  });

  it('HP = 4 + 费用', () => {
    expect(cardStats({ difficulty: 40, rarity: 'SR' }).hp).toBe(5);
    expect(cardStats({ difficulty: 40, rarity: 'SSR' }).hp).toBe(6);
    expect(cardStats({ difficulty: 40, rarity: 'UR' }).hp).toBe(7);
  });

  it('词根家族卡 ATK +2（封顶 10）并带技能描述', () => {
    expect(cardStats({ difficulty: 40, rarity: 'SR', hasRoot: true }).atk).toBe(7);
    expect(cardStats({ difficulty: 120, rarity: 'UR', hasRoot: true }).atk).toBe(10); // 封顶
    expect(cardStats({ difficulty: 40, rarity: 'SR', hasRoot: true }).skill).toContain('词根');
    expect(cardStats({ difficulty: 40, rarity: 'SR' }).skill).toBeUndefined();
  });
});

describe('buildHand（开局随机发手牌）', () => {
  const rng = () => 0.5;
  const pool = [
    { wordId: 'a', rarity: 'SR' as const, difficulty: 40 },
    { wordId: 'b', rarity: 'SSR' as const, difficulty: 70 },
    { wordId: 'c', rarity: 'UR' as const, difficulty: 90 },
    { wordId: 'd', rarity: 'SR' as const, difficulty: 50 },
  ];

  it('默认发 5 张，池不足循环补齐且去重', () => {
    const out = buildHand({ cards: pool, rng });
    expect(out).toHaveLength(5);
    expect(new Set(out).size).toBeLessThanOrEqual(4);
    expect(new Set(out).size).toBeGreaterThanOrEqual(1);
  });

  it('至少包含 1 张 1 费卡（新手必能出招）', () => {
    const out = buildHand({ cards: pool, rng });
    expect(out.some((id) => ['a', 'd'].includes(id))).toBe(true);
  });

  it('count 参数生效', () => {
    expect(buildHand({ cards: pool, count: 3, rng })).toHaveLength(3);
  });

  it('空池返回空数组', () => {
    expect(buildHand({ cards: [], rng })).toEqual([]);
  });

  it('同一 rng 序列输出确定', () => {
    const a = buildHand({ cards: pool, rng });
    const b = buildHand({ cards: pool, rng });
    expect(a).toEqual(b);
  });
});

describe('opponentThreat（对手随从威胁值）', () => {
  it('难度越高威胁越大，夹 3..12', () => {
    expect(opponentThreat(70)).toBe(8);
    expect(opponentThreat(40)).toBe(5);
    expect(opponentThreat(10)).toBe(3);
    expect(opponentThreat(120)).toBe(12);
    expect(opponentThreat(null)).toBe(5);
  });
});

describe('summonDamage（召唤伤害 = ATK + 连击加成）', () => {
  it('每 3 连击 +1，封顶 +5', () => {
    expect(summonDamage(9, 1)).toBe(9);
    expect(summonDamage(9, 2)).toBe(9);
    expect(summonDamage(9, 3)).toBe(10);
    expect(summonDamage(9, 5)).toBe(10);
    expect(summonDamage(9, 6)).toBe(11);
    expect(summonDamage(9, 9)).toBe(12);
    expect(summonDamage(9, 15)).toBe(14);
    expect(summonDamage(9, 30)).toBe(14);
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
  it('一场 10 回合、英雄 30 血、法力上限 10', () => {
    expect(BATTLE_QUESTION_COUNT).toBe(10);
    expect(HERO_MAX_HP).toBe(30);
    expect(MAX_MANA).toBe(10);
  });
});
