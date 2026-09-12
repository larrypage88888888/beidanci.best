import type { CardState, Rating, ScheduleResult } from './types';
import { GRADUATED_STAGE } from './ebbinghaus';

/**
 * FSRS-lite 智能（占位实现，M0 可用、M1 换完整 FSRS）
 *
 * 与设计文档 §4.3 模式 B 对应：每词维护 stability / difficulty，
 * 按个人作答反馈自适应调整间隔。当前实现是「带难度因子的指数增长模型」，
 * 接口与艾宾浩斯完全一致，M1 用 ts-fsrs 或自研 FSRS-5 替换内核即可，
 * 上层代码无需改动。
 */

const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 10;
const STABILITY_MIN_DAYS = 0.1;
const STABILITY_MAX_DAYS = 365;

/** 遗忘后的最短重考间隔（分钟） */
const LAPSE_RETRY_MIN = 10;

/** 各反馈对难度的增量：忘记→更难，模糊→略难，记得→变简单 */
const RATING_DIFFICULTY_DELTA: Record<Rating, number> = {
  forgot: +1.2,
  fuzzy: +0.3,
  remembered: -0.8,
};

/** 各反馈对应的稳定倍率：记得→大幅增长，模糊→微增，忘记→坍缩 */
function stabilityGrowth(rating: Rating): number {
  switch (rating) {
    case 'remembered':
      return 2.1;
    case 'fuzzy':
      return 1.15;
    case 'forgot':
      return 0.35;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  return addMinutes(date, days * 24 * 60);
}

/** 未学过的 FSRS 卡片初始参数 */
export const FSRS_INITIAL_DIFFICULTY = 6;

export function newFsrsState(wordId: string, now: Date = new Date()): CardState {
  return {
    wordId,
    mode: 'fsrs',
    stage: null,
    stability: null,
    fsrsDifficulty: null,
    dueAt: now.toISOString(),
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
  };
}

/** 由稳定性推下一次复习间隔天数（目标留存率约 90% 的简化映射） */
export function stabilityToIntervalDays(stability: number, difficulty: number): number {
  // 难度越高间隔越保守：difficulty 1 → ×1.25，difficulty 10 → ×0.55
  const difficultyFactor = 1.25 - ((difficulty - DIFFICULTY_MIN) / (DIFFICULTY_MAX - DIFFICULTY_MIN)) * 0.7;
  const raw = stability * difficultyFactor;
  return clamp(raw, STABILITY_MIN_DAYS, STABILITY_MAX_DAYS);
}

export function scheduleFsrs(
  state: CardState,
  rating: Rating,
  now: Date = new Date(),
): ScheduleResult {
  if (state.mode !== 'fsrs') {
    throw new Error(`scheduleFsrs: 卡片 ${state.wordId} 不是 fsrs 模式`);
  }

  let difficulty = state.fsrsDifficulty ?? FSRS_INITIAL_DIFFICULTY;
  let stability = state.stability ?? (rating === 'remembered' ? 1 : rating === 'fuzzy' ? 0.6 : 0.4);
  let lapses = state.lapses;
  let graduated = false;

  if (state.reps > 0) {
    // 已有历史：按反馈更新参数
    difficulty = clamp(difficulty + RATING_DIFFICULTY_DELTA[rating], DIFFICULTY_MIN, DIFFICULTY_MAX);
    if (rating === 'forgot') lapses += 1;
    const growth = stabilityGrowth(rating) - (difficulty - 5) * 0.04; // 词越难增长越慢
    stability = clamp(stability * Math.max(growth, 0.15), STABILITY_MIN_DAYS, STABILITY_MAX_DAYS);
  }

  let dueAt: string | null;
  let intervalMinutes: number | null;

  if (rating === 'forgot') {
    // 遗忘：短间隔快速重考
    intervalMinutes = LAPSE_RETRY_MIN;
    dueAt = addMinutes(now, intervalMinutes).toISOString();
  } else {
    const intervalDays = stabilityToIntervalDays(stability, difficulty);
    // 稳定度超过 60 天视为接近毕业（与艾宾浩斯的毕业语义对齐）
    graduated = stability >= 60 && rating === 'remembered' && state.reps >= 4;
    // 毕业后与艾宾浩斯保持一致：不再排期，间隔也为空
    intervalMinutes = graduated ? null : Math.round(intervalDays * 24 * 60);
    dueAt = graduated ? null : addDays(now, intervalDays).toISOString();
  }

  const next: CardState = {
    ...state,
    stage: graduated ? GRADUATED_STAGE : state.stage,
    stability,
    fsrsDifficulty: difficulty,
    reps: state.reps + 1,
    lapses,
    lastReviewAt: now.toISOString(),
    dueAt,
  };

  return { next, graduated, intervalMinutes };
}
