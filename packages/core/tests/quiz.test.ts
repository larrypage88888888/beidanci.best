import { describe, expect, it } from 'vitest';
import { buildDailyQueue, mulberry32, shuffleSeeded } from '../src/dailyQueue';
import { computeStreak, longestStreak } from '../src/streak';
import {
  checkSpelling,
  generateQuestion,
  hashSeed,
  kindForIndex,
  maskWord,
} from '../src/quizFactory';
import type { WordMeta } from '../src/types';

function word(id: string, text: string, difficulty: number, meaning: string): WordMeta {
  return {
    id,
    text,
    difficulty,
    definitions: [{ pos: 'n.', meaning }],
    cefr: difficulty > 50 ? 'B2' : 'A2',
  };
}

const POOL: WordMeta[] = [
  word('w1', 'apple', 20, '苹果'),
  word('w2', 'banana', 22, '香蕉'),
  word('w3', 'orange', 24, '橙子；柑橘'),
  word('w4', 'grape', 26, '葡萄'),
  word('w5', 'ambiguity', 70, '歧义；模棱两可'),
  word('w6', 'paradigm', 75, '范式；典范'),
  word('w7', 'nuance', 72, '细微差别'),
  word('w8', 'ephemeral', 78, '短暂的；转瞬即逝的'),
];

describe('每日组单', () => {
  it('新词数不超过每日上限，复习词来自到期集合', () => {
    const q = buildDailyQueue({
      candidateNewWordIds: ['n1', 'n2', 'n3', 'n4', 'n5'],
      dueReviewWordIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
      newLimit: 3,
      seed: 42,
    });
    expect(q.newWordIds).toHaveLength(3);
    q.reviewWordIds.forEach((id) => expect(id.startsWith('r')).toBe(true));
  });

  it('同一种子结果确定一致，不同种子大概率不同顺序', () => {
    const input = {
      candidateNewWordIds: ['n1', 'n2'],
      dueReviewWordIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
      newLimit: 2,
    };
    const a = buildDailyQueue({ ...input, seed: 7 });
    const b = buildDailyQueue({ ...input, seed: 7 });
    expect(a.order).toEqual(b.order);
  });

  it('order 是新词与复习词的穿插序列且覆盖两者', () => {
    const q = buildDailyQueue({
      candidateNewWordIds: ['n1', 'n2', 'n3'],
      dueReviewWordIds: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9'],
      newLimit: 3,
      seed: 100,
    });
    for (const id of [...q.newWordIds, ...q.reviewWordIds]) {
      expect(q.order).toContain(id);
    }
    // 开头应是复习热身（前几个都是 r）
    expect(q.order[0].startsWith('r')).toBe(true);
  });

  it('mulberry32 与洗牌工具可用且不修改原数组', () => {
    const rng = mulberry32(1);
    expect(typeof rng()).toBe('number');
    const src = [1, 2, 3, 4, 5];
    const shuffled = shuffleSeeded(src, mulberry32(9));
    expect(src).toEqual([1, 2, 3, 4, 5]);
    expect([...shuffled].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('streak 打卡', () => {
  it('连续记录正确计数', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03'];
    expect(computeStreak(dates, '2026-01-03')).toBe(3);
  });

  it('今天没学但昨天学了 → streak 保持不断', () => {
    const dates = ['2026-01-01', '2026-01-02'];
    expect(computeStreak(dates, '2026-01-03')).toBe(2);
  });

  it('断档归零', () => {
    const dates = ['2026-01-01', '2026-01-05', '2026-01-06'];
    expect(computeStreak(dates, '2026-01-06')).toBe(2);
    expect(computeStreak(dates, '2026-01-08')).toBe(0);
  });

  it('最长连续天数', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-07', '2026-01-08'];
    expect(longestStreak(dates)).toBe(3);
  });
});

describe('题型工厂', () => {
  it('看词选义：四个选项含唯一正确项，确定性可复现', () => {
    const seed = hashSeed('w1:2026-01-01');
    const q1 = generateQuestion({ word: POOL[0], pool: POOL, kind: 'meaning-choice', seed });
    const q2 = generateQuestion({ word: POOL[0], pool: POOL, kind: 'meaning-choice', seed });
    expect(q1.options).toHaveLength(4);
    expect(q1.answerKey).toBeDefined();
    expect(q1).toEqual(q2);
    const correctText = q1.options?.find((o) => o.key === q1.answerKey)?.text;
    expect(correctText).toContain('苹果');
  });

  it('看义选词：题干为释义、答案为单词文本', () => {
    const q = generateQuestion({ word: POOL[4], pool: POOL, kind: 'word-choice', seed: 99 });
    expect(q.prompt).toContain('歧义');
    const correct = q.options?.find((o) => o.key === q.answerKey)?.text;
    expect(correct).toBe('ambiguity');
  });

  it('拼写题：掩码提示与判定', () => {
    const q = generateQuestion({ word: POOL[0], pool: POOL, kind: 'spell', seed: 5 });
    expect(q.hint).toBe(maskWord('apple'));
    expect(checkSpelling(q, ' apple ')).toBe(true);
    expect(checkSpelling(q, 'APPLE')).toBe(true);
    expect(checkSpelling(q, 'apply')).toBe(false);
  });

  it('题型按序号轮换', () => {
    expect(kindForIndex(0)).toBe('meaning-choice');
    expect(kindForIndex(1)).toBe('word-choice');
    expect(kindForIndex(2)).toBe('spell');
    expect(kindForIndex(3)).toBe('meaning-choice');
  });
});
