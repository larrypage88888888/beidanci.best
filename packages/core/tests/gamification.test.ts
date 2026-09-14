import { describe, expect, it } from 'vitest';
import {
  CARD_ANSWER_THRESHOLD,
  CARD_COMBO_EXTRA,
  DUPLICATE_POINTS,
  PET_STAGES,
  REVIVE_WORD_COST,
  cardDrawAllowance,
  comboLevel,
  daysBetween,
  nextCombo,
  petStageForAge,
  rollCardRarity,
  shiftDateKey,
  updatePet,
} from '../src/gamification';
import type { PetRow } from '../src/gamification';

/* ── 连击 ── */
describe('combo', () => {
  it('答对递增、答错归零', () => {
    let c = { count: 0, best: 0 };
    c = nextCombo(c, true);
    c = nextCombo(c, true);
    c = nextCombo(c, true);
    expect(c).toEqual({ count: 3, best: 3 });
    c = nextCombo(c, false);
    expect(c).toEqual({ count: 0, best: 3 });
  });

  it('best 只增不减', () => {
    let c = { count: 0, best: 0 };
    c = nextCombo(c, true);
    c = nextCombo(c, true);
    c = nextCombo(c, false);
    c = nextCombo(c, true);
    expect(c.best).toBe(2);
    expect(c.count).toBe(1);
  });

  it('comboLevel 档位边界', () => {
    expect(comboLevel(1)).toBe(0);
    expect(comboLevel(5)).toBe(1);
    expect(comboLevel(9)).toBe(1);
    expect(comboLevel(10)).toBe(2);
    expect(comboLevel(49)).toBe(2);
    expect(comboLevel(50)).toBe(3);
    expect(comboLevel(99)).toBe(3);
  });
});

/* ── 词苗阶段 ── */
describe('petStageForAge', () => {
  it('0-2 词苗 / 3-6 小树 / 7-13 大树 / 14+ 开花', () => {
    expect(petStageForAge(0)).toBe(0);
    expect(petStageForAge(2)).toBe(0);
    expect(petStageForAge(3)).toBe(1);
    expect(petStageForAge(6)).toBe(1);
    expect(petStageForAge(7)).toBe(2);
    expect(petStageForAge(13)).toBe(2);
    expect(petStageForAge(14)).toBe(3);
    expect(petStageForAge(100)).toBe(3);
  });

  it('阶段标签与树龄对应', () => {
    expect(PET_STAGES[0].emoji).toBe('🌱');
    expect(PET_STAGES[3].emoji).toBe('🌸');
  });
});

/* ── 日期工具 ── */
describe('date helpers', () => {
  it('shiftDateKey 加减天', () => {
    expect(shiftDateKey('2026-09-14', 1)).toBe('2026-09-15');
    expect(shiftDateKey('2026-09-14', -1)).toBe('2026-09-13');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('daysBetween', () => {
    expect(daysBetween('2026-09-14', '2026-09-15')).toBe(1);
    expect(daysBetween('2026-09-14', '2026-09-12')).toBe(-2);
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
  });
});

/* ── 词苗状态机 ── */
const T = '2026-09-14';

function row(partial: Partial<PetRow>): PetRow {
  return {
    stageIdx: 0,
    treeAgeDays: 1,
    lastWaterAt: T,
    wiltSince: null,
    reviveDeadline: null,
    wilted: false,
    ...partial,
  };
}

describe('updatePet', () => {
  it('首次学习 → 建苗并发放初始复活卡', () => {
    const r = updatePet(null, { today: T, todayReviewed: 1, hasReviveCard: false });
    expect(r.grantReviveCard).toBe(true);
    expect(r.pet.treeAgeDays).toBe(1);
    expect(r.pet.wilted).toBe(false);
  });

  it('同日多次回写不重复计树龄', () => {
    const prev = row({ treeAgeDays: 3 });
    const r = updatePet(prev, { today: T, todayReviewed: 8, hasReviveCard: false });
    expect(r.pet.treeAgeDays).toBe(3);
  });

  it('连续第二天 → 树龄 +1', () => {
    const prev = row({ treeAgeDays: 3, lastWaterAt: '2026-09-13' });
    const r = updatePet(prev, { today: T, todayReviewed: 3, hasReviveCard: false });
    expect(r.pet.treeAgeDays).toBe(4);
    expect(r.pet.stageIdx).toBe(1);
  });

  it('断签一天后回来且在 48h 内 → 自动救活（学满 5 词）', () => {
    const prev = row({ treeAgeDays: 5, lastWaterAt: '2026-09-11' }); // 断 9/12、9/13 两天
    const r = updatePet(prev, { today: T, todayReviewed: 5, hasReviveCard: false });
    expect(r.revived).toBe(true);
    expect(r.pet.wilted).toBe(false);
    expect(r.pet.treeAgeDays).toBe(6);
  });

  it('断签回来但没学满 5 词且有复活卡 → 消耗卡救活', () => {
    const prev = row({ treeAgeDays: 5, lastWaterAt: '2026-09-11' });
    const r = updatePet(prev, { today: T, todayReviewed: 1, hasReviveCard: true });
    expect(r.revived).toBe(true);
    expect(r.consumedReviveCard).toBe(true);
    expect(r.pet.treeAgeDays).toBe(6);
  });

  it('断签回来既没学满也没卡 → 维持枯萎并提示还差几题', () => {
    const prev = row({ treeAgeDays: 5, lastWaterAt: '2026-09-11' });
    const r = updatePet(prev, { today: T, todayReviewed: 2, hasReviveCard: false });
    expect(r.revived).toBe(false);
    expect(r.pet.wilted).toBe(true);
    expect(r.needsWords).toBe(REVIVE_WORD_COST - 2);
    // 树龄不增长
    expect(r.pet.treeAgeDays).toBe(5);
  });

  it('断签在 48h 内、学满 5 词救活后，同一天再次回写不再扣卡', () => {
    const prev = row({ treeAgeDays: 5, lastWaterAt: '2026-09-11' });
    const r1 = updatePet(prev, { today: T, todayReviewed: 5, hasReviveCard: false });
    expect(r1.revived).toBe(true);
    const r2 = updatePet(r1.pet, { today: T, todayReviewed: 8, hasReviveCard: false });
    expect(r2.pet.wilted).toBe(false);
    expect(r2.pet.treeAgeDays).toBe(6);
  });

  it('超过 48h 才回来 → 硬重置，树龄归零', () => {
    const prev = row({ treeAgeDays: 10, lastWaterAt: '2026-09-08' }); // 断 9/9，48h 截止 9/11
    const r = updatePet(prev, { today: '2026-09-14', todayReviewed: 6, hasReviveCard: true });
    expect(r.hardReset).toBe(true);
    expect(r.pet.treeAgeDays).toBe(0);
    expect(r.pet.stageIdx).toBe(0);
    expect(r.pet.wilted).toBe(false);
  });

  it('宽限期的边界：截止日当天回来仍可救活', () => {
    // 断签首日 9/9，截止 9/11（含）——9/11 回来且学满 5 词
    const prev = row({ treeAgeDays: 4, lastWaterAt: '2026-09-08' });
    const r = updatePet(prev, { today: '2026-09-11', todayReviewed: 5, hasReviveCard: false });
    expect(r.revived).toBe(true);
  });
});

/* ── 抽卡 ── */
describe('card draw', () => {
  it('资格：作答≥15 得 1 次，最高连击≥10 再 +1', () => {
    expect(cardDrawAllowance({ answeredToday: 14, comboBest: 9, drawn: 0 }).eligible).toBe(0);
    expect(cardDrawAllowance({ answeredToday: CARD_ANSWER_THRESHOLD, comboBest: 0, drawn: 0 }).eligible).toBe(1);
    expect(cardDrawAllowance({ answeredToday: 20, comboBest: CARD_COMBO_EXTRA, drawn: 0 }).eligible).toBe(2);
  });

  it('已抽次数扣减剩余', () => {
    expect(cardDrawAllowance({ answeredToday: 20, comboBest: 10, drawn: 1 }).remaining).toBe(1);
    expect(cardDrawAllowance({ answeredToday: 20, comboBest: 10, drawn: 2 }).remaining).toBe(0);
  });

  it('稀有度掷点只落在 SR/SSR/UR，且 UR 稀有', () => {
    const counts: Record<string, number> = { SR: 0, SSR: 0, UR: 0 };
    for (let i = 0; i < 50_000; i++) counts[rollCardRarity(i)] += 1;
    expect(counts.SR + counts.SSR + counts.UR).toBe(50_000);
    expect(counts.UR / 50_000).toBeLessThan(0.1);
    expect(counts.SR / 50_000).toBeGreaterThan(0.6);
  });

  it('重复词积分映射', () => {
    expect(DUPLICATE_POINTS.UR).toBeGreaterThan(DUPLICATE_POINTS.SSR);
    expect(DUPLICATE_POINTS.SSR).toBeGreaterThan(DUPLICATE_POINTS.SR);
  });
});
