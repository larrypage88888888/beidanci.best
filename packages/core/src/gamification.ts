/**
 * 趣味化增强 P0（设计文档 §十）：连击 / 词苗养成 / 词卡抽卡 的纯函数规则。
 * web 与 server 共用同一份判定，保证两端一致。
 */

import { mulberry32 } from './dailyQueue';

/* ────────────────────────── 连击 ────────────────────────── */

export interface ComboState {
  /** 当前连击数（会话内连续答对次数，答错归零） */
  count: number;
  /** 会话内最高连击（用于当日纪录/抽卡加成/周报） */
  best: number;
}

export function newCombo(): ComboState {
  return { count: 0, best: 0 };
}

/** 答对 count+1；答错归零；best 只增不减 */
export function nextCombo(prev: ComboState, correct: boolean): ComboState {
  const count = correct ? prev.count + 1 : 0;
  return { count, best: Math.max(prev.best, count) };
}

/** 连击的视觉档位（前端据此换色/特效） */
export function comboLevel(count: number): 0 | 1 | 2 | 3 {
  if (count >= 50) return 3;
  if (count >= 10) return 2;
  if (count >= 5) return 1;
  return 0;
}

/* ─────────────────────── 词苗养成 ─────────────────────── */

/** 树龄 = 有学习活动的累计天数（断签可 48h 内救活，救活前不再增长） */
export interface PetRow {
  /** 0 词苗 / 1 小树 / 2 大树 / 3 开花结果 */
  stageIdx: 0 | 1 | 2 | 3;
  treeAgeDays: number;
  /** 最近一次有学习活动的日期 YYYY-MM-DD (UTC) */
  lastWaterAt: string;
  /** 首次断签日 YYYY-MM-DD（无断签为 null） */
  wiltSince: string | null;
  /** 救活截止日 YYYY-MM-DD（含当天）；超过则硬重置 */
  reviveDeadline: string | null;
  /** 当前是否处于枯萎状态 */
  wilted: boolean;
}

export const PET_STAGES = [
  { label: '词苗', emoji: '🌱' },
  { label: '小树', emoji: '🌿' },
  { label: '大树', emoji: '🌳' },
  { label: '开花结果', emoji: '🌸' },
] as const;

/** 树龄 → 阶段：0-2 苗 / 3-6 小树 / 7-13 大树 / 14+ 开花 */
export function petStageForAge(days: number): 0 | 1 | 2 | 3 {
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  if (days >= 3) return 1;
  return 0;
}

/** 「学 5 个词」救活路径所需题数（设计决策 #1：48h 宽限救活） */
export const REVIVE_WORD_COST = 5;

/** YYYY-MM-DD 加减天数 */
export function shiftDateKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  if (y == null || m == null || d == null) return key;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** b - a 的整天数（a、b 为 YYYY-MM-DD） */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ta = Date.UTC(ay ?? 0, (am ?? 1) - 1, ad ?? 1);
  const tb = Date.UTC(by ?? 0, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((tb - ta) / 86_400_000);
}

export interface PetUpdateResult {
  pet: PetRow;
  /** 本次活动把枯萎的词苗救活了 */
  revived: boolean;
  /** 超过救活期限，树被硬重置（树龄归零重新生长） */
  hardReset: boolean;
  /** 新建词苗（调用方应发放 1 张初始复活卡） */
  grantReviveCard: boolean;
  /** 本次救活是否消耗了 1 张复活卡 */
  consumedReviveCard: boolean;
  /** 枯萎中：距「学 5 词」自动救活还差几题（0 = 本次已满足） */
  needsWords: number;
}

function cleanPet(today: string, ageDays: number): PetRow {
  return {
    stageIdx: petStageForAge(ageDays),
    treeAgeDays: ageDays,
    lastWaterAt: today,
    wiltSince: null,
    reviveDeadline: null,
    wilted: false,
  };
}

/**
 * 每次有学习活动时调用，推进词苗状态机。
 *
 * @param prev            现有词苗行（无则 null）
 * @param opts.today      YYYY-MM-DD (UTC)
 * @param opts.todayReviewed 今天累计已作答数（含本次回写）
 * @param opts.hasReviveCard 用户是否持有 ≥1 张复活卡
 */
export function updatePet(
  prev: PetRow | null,
  opts: { today: string; todayReviewed: number; hasReviveCard: boolean },
): PetUpdateResult {
  const { today, todayReviewed, hasReviveCard } = opts;
  const base = { revived: false, hardReset: false, grantReviveCard: false, consumedReviveCard: false, needsWords: 0 };

  // 第一次学习 → 建苗
  if (!prev) {
    return { ...base, grantReviveCard: true, pet: cleanPet(today, 1) };
  }

  const gap = daysBetween(prev.lastWaterAt, today);

  // 同日多次回写：不重复计树龄；若在枯萎中，借本次回写看能否救活
  if (gap <= 0) {
    if (!prev.wilted) return { ...base, pet: { ...prev, lastWaterAt: today } };
    return tryRevive(prev, { today, todayReviewed, hasReviveCard });
  }

  // 连续（昨天/更近）→ 正常浇水
  if (gap === 1) {
    return { ...base, pet: cleanPet(today, prev.treeAgeDays + 1) };
  }

  // 断签 ≥1 整天
  const wiltSince = prev.wiltSince ?? shiftDateKey(prev.lastWaterAt, 1);
  const reviveDeadline = prev.reviveDeadline ?? shiftDateKey(wiltSince, 2); // 断签日 +2 天 = 48h 宽限

  if (today > reviveDeadline) {
    // 回来太晚，树已枯萎致死 → 硬重置，从苗重新开始
    return { ...base, hardReset: true, pet: cleanPet(today, 0) };
  }

  return tryRevive(
    { ...prev, wilted: true, wiltSince, reviveDeadline },
    { today, todayReviewed, hasReviveCard },
  );
}

/** 枯萎中的救活判定：学满 5 词自动救活，其次消耗复活卡，否则维持枯萎 */
function tryRevive(
  prev: PetRow,
  opts: { today: string; todayReviewed: number; hasReviveCard: boolean },
): PetUpdateResult {
  const { today, todayReviewed, hasReviveCard } = opts;
  const base = { revived: false, hardReset: false, grantReviveCard: false, consumedReviveCard: false, needsWords: 0 };

  if (todayReviewed >= REVIVE_WORD_COST) {
    return { ...base, revived: true, pet: cleanPet(today, prev.treeAgeDays + 1) };
  }
  if (hasReviveCard) {
    return { ...base, revived: true, consumedReviveCard: true, pet: cleanPet(today, prev.treeAgeDays + 1) };
  }
  return {
    ...base,
    pet: { ...prev, lastWaterAt: today },
    needsWords: Math.max(0, REVIVE_WORD_COST - todayReviewed),
  };
}

/* ─────────────────────── 词卡抽卡 ─────────────────────── */

export type CardRarity = 'SR' | 'SSR' | 'UR';

export const CARD_RARITY_WEIGHTS: ReadonlyArray<{ rarity: CardRarity; weight: number }> = [
  { rarity: 'SR', weight: 75 },
  { rarity: 'SSR', weight: 20 },
  { rarity: 'UR', weight: 5 },
] as const;

/** 抽到已收藏词时转换的词力积分（决策 #2） */
export const DUPLICATE_POINTS: Record<CardRarity, number> = { SR: 5, SSR: 20, UR: 50 };

/** 每日抽卡基准门槛：当天累计作答 ≥15 词 → 基础 1 次；当日最高连击 ≥10 → 额外 +1（决策 #5） */
export const CARD_ANSWER_THRESHOLD = 15;
export const CARD_COMBO_EXTRA = 10;

/** 用种子确定性掷稀有度（便于测试复现；服务端用强随机种子） */
export function rollCardRarity(seed: number): CardRarity {
  const rnd = mulberry32(seed >>> 0)();
  let acc = 0;
  for (const { rarity, weight } of CARD_RARITY_WEIGHTS) {
    acc += weight;
    if (rnd * 100 < acc) return rarity;
  }
  return 'SR';
}

/** 今日可抽次数与剩余次数（eligible - 已抽） */
export function cardDrawAllowance(opts: { answeredToday: number; comboBest: number; drawn: number }): {
  eligible: number;
  remaining: number;
} {
  const base = opts.answeredToday >= CARD_ANSWER_THRESHOLD ? 1 : 0;
  const extra = opts.comboBest >= CARD_COMBO_EXTRA ? 1 : 0;
  const eligible = base + extra;
  return { eligible, remaining: Math.max(0, eligible - opts.drawn) };
}
