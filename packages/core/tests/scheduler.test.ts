import { describe, expect, it } from 'vitest';
import {
  GRADUATED_STAGE,
  newEbbinghausState,
  scheduleEbbinghaus,
  stageIntervalMinutes,
} from '../src/ebbinghaus';
import { createInitialState, migrateCardState, schedule } from '../src/scheduler';
import type { CardState } from '../src/types';

const T0 = new Date('2026-01-01T08:00:00Z');

describe('艾宾浩斯调度器', () => {
  it('间隔表符合设计文档的固定节点序列', () => {
    expect(stageIntervalMinutes(0)).toBe(5);
    expect(stageIntervalMinutes(1)).toBe(30);
    expect(stageIntervalMinutes(2)).toBe(12 * 60);
    expect(stageIntervalMinutes(3)).toBe(24 * 60);
    expect(stageIntervalMinutes(8)).toBe(30 * 24 * 60);
    expect(stageIntervalMinutes(GRADUATED_STAGE)).toBeNull();
  });

  it('新词首次作答从第 0 级起步', () => {
    const card = newEbbinghausState('w1', T0);
    expect(card.stage).toBeNull();
    const r = scheduleEbbinghaus(card, 'remembered', T0);
    expect(r.next.stage).toBe(1); // 记得 → 从0级晋升到第1级
    expect(r.intervalMinutes).toBe(30);
  });

  it('忘记 → 回到第0级重来并累计 lapses', () => {
    let card = newEbbinghausState('w1', T0);
    card = scheduleEbbinghaus(card, 'remembered', T0).next;
    card = scheduleEbbinghaus(card, 'remembered', T0).next; // 第2级
    const r = scheduleEbbinghaus(card, 'forgot', T0);
    expect(r.next.stage).toBe(0);
    expect(r.next.lapses).toBe(1);
    expect(r.intervalMinutes).toBe(5);
  });

  it('模糊 → 停留本级重考', () => {
    let card = newEbbinghausState('w1', T0);
    card = scheduleEbbinghaus(card, 'remembered', T0).next; // 第1级
    const r = scheduleEbbinghaus(card, 'fuzzy', T0);
    expect(r.next.stage).toBe(1); // 原地停留
    expect(r.next.lapses).toBe(0);
    expect(r.intervalMinutes).toBe(30);
  });

  it('记得 → 晋升下一级，dueAt 按 ISO 推进对应间隔', () => {
    let card = newEbbinghausState('w1', T0);
    const r = scheduleEbbinghaus(card, 'remembered', T0);
    expect(r.next.dueAt).toBe(new Date(T0.getTime() + 30 * 60_000).toISOString());
  });

  it('第8级再答对 → 毕业，不再排期', () => {
    const card: CardState = {
      wordId: 'w1',
      mode: 'ebbinghaus',
      stage: 8,
      stability: null,
      fsrsDifficulty: null,
      dueAt: T0.toISOString(),
      reps: 9,
      lapses: 0,
      lastReviewAt: null,
    };
    const r = scheduleEbbinghaus(card, 'remembered', T0);
    expect(r.graduated).toBe(true);
    expect(r.next.stage).toBe(GRADUATED_STAGE);
    expect(r.next.dueAt).toBeNull();
    expect(r.intervalMinutes).toBeNull();
  });

  it('统一入口按模式分发且结果一致', () => {
    const a = createInitialState('w1', 'ebbinghaus', T0);
    const viaEntry = schedule(a, 'remembered', T0);
    const viaDirect = scheduleEbbinghaus(a, 'remembered', T0);
    expect(viaEntry.next).toEqual(viaDirect.next);
  });
});

describe('FSRS-lite 调度器', () => {
  it('记得 → 稳定性增长、难度下降', () => {
    const card = createInitialState('w2', 'fsrs', T0);
    const r1 = schedule(card, 'remembered', T0);
    const r2 = schedule(r1.next, 'remembered', T0);
    expect(r2.next.stability!).toBeGreaterThan(r1.next.stability!);
    expect(r2.next.fsrsDifficulty!).toBeLessThan(r1.next.fsrsDifficulty!);
  });

  it('忘记 → 短间隔重考并累计 lapses', () => {
    const card = createInitialState('w2', 'fsrs', T0);
    const grown = schedule(schedule(card, 'remembered', T0).next, 'remembered', T0).next;
    const forgot = schedule(grown, 'forgot', T0);
    expect(forgot.next.lapses).toBe(1);
    expect(forgot.intervalMinutes).toBe(10);
  });

  it('模式迁移不丢进度：艾宾浩斯→FSRS→艾宾浩斯级别近似保持', () => {
    let card = createInitialState('w3', 'ebbinghaus', T0);
    card = schedule(card, 'remembered', T0).next; // 第1级
    card = schedule(card, 'remembered', T0).next; // 第2级

    const toFsrs = migrateCardState(card, 'fsrs');
    expect(toFsrs.mode).toBe('fsrs');
    expect(toFsrs.stability).not.toBeNull();

    const back = migrateCardState(toFsrs, 'ebbinghaus');
    expect(back.mode).toBe('ebbinghaus');
    expect(back.stage).toBeGreaterThanOrEqual(1);
    expect(back.stage).toBeLessThanOrEqual(2);
  });
});
