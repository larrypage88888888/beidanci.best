import { describe, expect, it } from 'vitest';
import { buildDailyQueue, remainingNewQuota } from '../src/dailyQueue';
import { hashSeed } from '../src/quizFactory';
import { GRADUATED_STAGE } from '../src/ebbinghaus';
import { createInitialState, migrateCardState, schedule } from '../src/scheduler';

const T0 = new Date('2026-01-01T08:00:00Z');

describe('模式迁移边界（设置页切换调度模式）', () => {
  it('高级别往返：stage 7 → FSRS 稳定性封顶 45 天 → 回迁不丢到第5级以下', () => {
    let card = createInitialState('w1', 'ebbinghaus', T0);
    for (let i = 0; i < 7; i++) card = schedule(card, 'remembered', T0).next;
    expect(card.stage).toBe(7);

    const toFsrs = migrateCardState(card, 'fsrs');
    expect(toFsrs.mode).toBe('fsrs');
    expect(toFsrs.stability!).toBeLessThanOrEqual(45);
    expect(toFsrs.stability!).toBeGreaterThan(20); // 高级别应有较高稳定性

    const back = migrateCardState(toFsrs, 'ebbinghaus');
    expect(back.mode).toBe('ebbinghaus');
    expect(back.stage).toBeGreaterThanOrEqual(5);
    expect(back.stage).toBeLessThanOrEqual(7);
    expect(back.stability).toBeNull();
  });

  it('同模式迁移幂等：FSRS 卡片参数原样保留', () => {
    let card = createInitialState('w2', 'fsrs', T0);
    card = schedule(card, 'remembered', T0).next;
    const same = migrateCardState(card, 'fsrs');
    expect(same.stability).toBe(card.stability);
    expect(same.fsrsDifficulty).toBe(card.fsrsDifficulty);
    expect(same.dueAt).toBe(card.dueAt);
  });

  it('未学卡片（stage=null）往返迁移只改模式、不动排期', () => {
    const fresh = createInitialState('w3', 'ebbinghaus', T0);
    const roundtrip = migrateCardState(migrateCardState(fresh, 'fsrs'), 'ebbinghaus');
    expect(roundtrip.mode).toBe('ebbinghaus');
    expect(roundtrip.stage).toBeNull();
    expect(roundtrip.reps).toBe(0);
  });

  it('低级别往返：stage 1 → 回迁后仍在第1级附近（±1）', () => {
    let card = createInitialState('w4', 'ebbinghaus', T0);
    card = schedule(card, 'remembered', T0).next; // stage 1
    const back = migrateCardState(migrateCardState(card, 'fsrs'), 'ebbinghaus');
    expect(back.stage).toBeGreaterThanOrEqual(0);
    expect(back.stage).toBeLessThanOrEqual(2);
  });
});

describe('FSRS 毕业语义', () => {
  it('stability≥60 且 reps≥4 且记得 → 毕业，不再排期', () => {
    const card = {
      ...createInitialState('w5', 'fsrs', T0),
      stability: 70,
      fsrsDifficulty: 3,
      reps: 4,
      dueAt: T0.toISOString(),
    };
    const r = schedule(card, 'remembered', T0);
    expect(r.graduated).toBe(true);
    expect(r.next.stage).toBe(GRADUATED_STAGE);
    expect(r.next.dueAt).toBeNull();
    expect(r.intervalMinutes).toBeNull();
  });

  it('stability≥60 但首次作答（reps<4）不毕业，继续巩固', () => {
    const card = {
      ...createInitialState('w6', 'fsrs', T0),
      stability: 70,
      fsrsDifficulty: 3,
      reps: 1,
      dueAt: T0.toISOString(),
    };
    const r = schedule(card, 'remembered', T0);
    expect(r.graduated).toBe(false);
    expect(r.next.dueAt).not.toBeNull();
  });
});

describe('新词配额计算', () => {
  it.each([
    [10, 0, 10],
    [10, 3, 7],
    [10, 10, 0],
    [5, 9, 0], // 已学超限不出现负数
  ])('remainingNewQuota(%i, %i) = %i', (limit, used, expected) => {
    expect(remainingNewQuota(limit, used)).toBe(expected);
  });
});

describe('每日组单边界情况', () => {
  it('newLimit=0：只出复习词，不出新词', () => {
    const q = buildDailyQueue({
      candidateNewWordIds: ['n1', 'n2'],
      dueReviewWordIds: ['r1', 'r2', 'r3', 'r4'],
      newLimit: 0,
      seed: hashSeed('quota-zero'),
    });
    expect(q.newWordIds).toHaveLength(0);
    expect(q.order).toHaveLength(4);
    expect(new Set(q.order)).toEqual(new Set(['r1', 'r2', 'r3', 'r4']));
  });

  it('无到期词：只出新词且不超过上限', () => {
    const q = buildDailyQueue({
      candidateNewWordIds: ['n1', 'n2', 'n3'],
      dueReviewWordIds: [],
      newLimit: 2,
      seed: 1,
    });
    expect(q.order).toEqual(['n1', 'n2']);
  });

  it('候选不足时有多少出多少', () => {
    const q = buildDailyQueue({
      candidateNewWordIds: ['only-one'],
      dueReviewWordIds: [],
      newLimit: 10,
      seed: 1,
    });
    expect(q.order).toEqual(['only-one']);
  });

  it('同种子两次组单完全一致（当日重复拉取稳定）', () => {
    const input = {
      candidateNewWordIds: ['n1', 'n2', 'n3'],
      dueReviewWordIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      newLimit: 2,
      seed: 42,
    };
    expect(buildDailyQueue(input)).toEqual(buildDailyQueue(input));
  });
});
