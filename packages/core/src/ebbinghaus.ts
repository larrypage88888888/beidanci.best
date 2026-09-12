import type { CardState, Rating, ScheduleMode, ScheduleResult } from './types';

/**
 * 艾宾浩斯经典调度器
 *
 * 固定复习节点序列（设计文档 §4.3 模式 A，默认模式、规则透明可解释）：
 *   第0级 5分钟 → 第1级 30分钟 → 第2级 12小时 → 第3级 1天 → 第4级 2天
 *   → 第5级 4天 → 第6级 7天 → 第7级 15天 → 第8级 30天 → 毕业(第9级)
 *
 * 作答反馈映射：
 *   忘记 forgot     → 回到第0级重来
 *   模糊 fuzzy      → 停留本级重考
 *   记得 remembered → 晋升下一级
 */

/** 各级别的复习间隔（分钟），下标 = 级别 stage */
export const EBBINGHAUS_STAGE_INTERVALS_MIN: readonly number[] = [
  5, // 第0级 5 分钟
  30, // 第1级 30 分钟
  12 * 60, // 第2级 12 小时
  24 * 60, // 第3级 1 天
  2 * 24 * 60, // 第4级 2 天
  4 * 24 * 60, // 第5级 4 天
  7 * 24 * 60, // 第6级 7 天
  15 * 24 * 60, // 第7级 15 天
  30 * 24 * 60, // 第8级 30 天
] as const;

/** 毕业级别（到达即不再排期） */
export const GRADUATED_STAGE = 9;

/** 查询某级别的复习间隔分钟数；毕业或非法级别返回 null */
export function stageIntervalMinutes(stage: number): number | null {
  if (stage < 0 || stage >= EBBINGHAUS_STAGE_INTERVALS_MIN.length) return null;
  return EBBINGHAUS_STAGE_INTERVALS_MIN[stage];
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** 新建一张未学习的艾宾浩斯卡片：立即到期（作为新词出现） */
export function newEbbinghausState(wordId: string, now: Date = new Date()): CardState {
  return {
    wordId,
    mode: 'ebbinghaus',
    stage: null,
    stability: null,
    fsrsDifficulty: null,
    dueAt: now.toISOString(),
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
  };
}

/**
 * 对一张卡应用一次作答反馈，返回下一状态（纯函数，不产生副作用）。
 */
export function scheduleEbbinghaus(
  state: CardState,
  rating: Rating,
  now: Date = new Date(),
): ScheduleResult {
  if (state.mode !== 'ebbinghaus') {
    throw new Error(`scheduleEbbinghaus: 卡片 ${state.wordId} 不是 ebbinghaus 模式`);
  }

  // 未学过的词首次作答从第 0 级起步
  let stage = state.stage ?? 0;
  let lapses = state.lapses;

  switch (rating) {
    case 'forgot':
      stage = 0; // 回到第 0 级重来
      lapses += 1;
      break;
    case 'fuzzy':
      // 停留本级重考：stage 不变
      break;
    case 'remembered':
      stage = Math.min(stage + 1, GRADUATED_STAGE);
      break;
  }

  const graduated = stage >= GRADUATED_STAGE;
  const intervalMinutes = graduated ? null : stageIntervalMinutes(stage);
  if (!graduated && intervalMinutes == null) {
    throw new Error(`scheduleEbbinghaus: 非法级别 ${stage}`);
  }

  const next: CardState = {
    ...state,
    stage,
    lapses,
    reps: state.reps + 1,
    lastReviewAt: now.toISOString(),
    dueAt: graduated || intervalMinutes == null ? null : addMinutes(now, intervalMinutes).toISOString(),
  };

  return { next, graduated, intervalMinutes };
}

/** 展示用：把级别翻译成人类可读的间隔描述（游戏化进度条文案） */
export function describeStage(stage: number): string {
  if (stage >= GRADUATED_STAGE) return '已毕业 🎓';
  const min = stageIntervalMinutes(stage);
  if (min == null) return `第${stage}级`;
  if (min < 60) return `${stage}级 · ${min}分钟`;
  if (min < 60 * 24) return `${stage}级 · ${min / 60}小时`;
  return `${stage}级 · ${min / (60 * 24)}天`;
}
