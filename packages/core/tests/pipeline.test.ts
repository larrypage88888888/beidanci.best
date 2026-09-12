import { describe, expect, it } from 'vitest';
import { computeDifficulty, difficultyToCefr, levelBand } from '../src/difficulty';
import {
  PLACEMENT_MAX_QUESTIONS,
  answerPlacement,
  finishPlacement,
  isPlacementDone,
  pickPlacementWord,
  startPlacement,
} from '../src/placement';
import type { WordMeta } from '../src/types';

describe('统一难度轴', () => {
  it('简单词得分低于难词', () => {
    const easy = computeDifficulty({ text: 'cat', cefr: 'A1', frequencyRank: 300 });
    const hard = computeDifficulty({ text: 'ubiquitousness', cefr: 'C2', frequencyRank: 45000 });
    expect(easy).toBeLessThan(hard);
    expect(easy).toBeGreaterThanOrEqual(0);
    expect(hard).toBeLessThanOrEqual(100);
  });

  it('确定性：同输入同输出', () => {
    const input = { text: 'apple', cefr: 'A1' as const, frequencyRank: 1500 };
    expect(computeDifficulty(input)).toBe(computeDifficulty(input));
  });

  it('缺 CEFR 时仍能给出有意义的分数（权重摊派）', () => {
    const d = computeDifficulty({ text: 'run', frequencyRank: 100 });
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(50);
  });

  it('难度分能映射回合理 CEFR 档位', () => {
    expect(difficultyToCefr(10)).toBe('A1');
    expect(difficultyToCefr(90)).toBe('C2');
  });

  it('levelBand 给出水平±半档区间', () => {
    expect(levelBand(50, 12)).toEqual({ min: 38, max: 62 });
    expect(levelBand(5, 12).min).toBe(0);
    expect(levelBand(95, 12).max).toBe(100);
  });
});

/** 构造一个模拟词库：难度均匀分布 */
function makePool(n = 200): WordMeta[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i}`,
    text: `word${i}`,
    difficulty: Math.round((i / (n - 1)) * 100),
  }));
}

describe('自适应摸底测试', () => {
  it('高能力用户收敛到高水平', () => {
    const pool = makePool();
    const abilityOf = (w: WordMeta) => w.difficulty ?? 50;

    let session = startPlacement();
    while (!isPlacementDone(session)) {
      const word = pickPlacementWord(session, pool);
      if (!word) break;
      // 模拟真实水平约 75 的用户：低于其水平的题基本会做
      const correct = abilityOf(word) <= 75 ? true : false;
      session = answerPlacement(session, abilityOf(word), correct);
    }
    const result = finishPlacement(session);
    expect(result.level).toBeGreaterThan(60);
    expect(result.vocabEstimate).toBeGreaterThan(4000);
    expect(session.questionCount).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
  });

  it('低能力用户收敛到低水平', () => {
    const pool = makePool();
    let session = startPlacement();
    while (!isPlacementDone(session)) {
      const word = pickPlacementWord(session, pool);
      if (!word) break;
      const correct = (word.difficulty ?? 50) <= 20;
      session = answerPlacement(session, word.difficulty ?? 50, correct);
    }
    const result = finishPlacement(session);
    expect(result.level).toBeLessThan(40);
  });

  it('不会重复出同一道题', () => {
    const pool = makePool();
    let session = startPlacement();
    const seen = new Set<string>();
    for (let i = 0; i < 10 && !isPlacementDone(session); i++) {
      const word = pickPlacementWord(session, pool);
      if (!word) break;
      expect(seen.has(word.id)).toBe(false);
      seen.add(word.id);
      session = answerPlacement(session, word.difficulty ?? 50, i % 2 === 0);
    }
  });
});
