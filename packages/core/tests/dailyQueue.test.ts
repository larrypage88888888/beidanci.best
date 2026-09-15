import { describe, expect, it } from 'vitest';
import { mulberry32, pickByInitials } from '../src/dailyQueue';

describe('pickByInitials（新词首字母分桶轮转）', () => {
  // 模拟 cet4 50-74 难度段：c/a 打头占 75%（与真实词库分布一致）
  const pool = [
    'ability', 'absorb', 'abstract', 'academic', 'accelerate', 'accommodate', // a×6
    'campus', 'candidate', 'capable', 'capacity', 'celebrate', 'challenge', 'character', 'circumstance', 'civilization', 'commercial', 'committed', 'companion', // c×12
    'illustrate', 'imagination', // i×2
    'balance', 'bargain', // b×2
    'hesitate', // h×1
    'familiar', // f×1
  ];

  it('取 10 个词时首字母尽量分散（不出现同一字母扎堆）', () => {
    const rng = mulberry32(42);
    const picked = pickByInitials(pool, 10, rng);
    expect(picked).toHaveLength(10);
    // 轮转取法：10 个词至少覆盖 4 个不同首字母，且任一字母最多占 4 个
    const counts = new Map<string, number>();
    for (const w of picked) {
      const ch = w[0];
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
  });

  it('确定性：同一种子结果一致', () => {
    const a = pickByInitials(pool, 10, mulberry32(7));
    const b = pickByInitials(pool, 10, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('不同种子结果不同（跨天随机）', () => {
    const a = pickByInitials(pool, 10, mulberry32(1));
    const b = pickByInitials(pool, 10, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('候选不足时取全部', () => {
    const picked = pickByInitials(['ability', 'balance'], 5, mulberry32(1));
    expect(picked.sort()).toEqual(['ability', 'balance']);
  });

  it('n=0 返回空', () => {
    expect(pickByInitials(pool, 0, mulberry32(1))).toEqual([]);
  });

  it('不修改原数组', () => {
    const copy = [...pool];
    pickByInitials(pool, 10, mulberry32(3));
    expect(pool).toEqual(copy);
  });
});
