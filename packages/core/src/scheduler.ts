import type { CardState, Rating, ScheduleMode, ScheduleResult } from './types';
import { newEbbinghausState, scheduleEbbinghaus } from './ebbinghaus';
import { newFsrsState, scheduleFsrs } from './fsrsLite';

/**
 * 统一调度入口（设计文档 §4.3：两个调度器实现同一接口）
 * 用户可在设置中切换模式，服务端按 user.schedule_mode 分发。
 */

export function createInitialState(wordId: string, mode: ScheduleMode, now: Date = new Date()): CardState {
  return mode === 'fsrs' ? newFsrsState(wordId, now) : newEbbinghausState(wordId, now);
}

/** 对任意模式的卡片应用一次作答反馈（纯函数） */
export function schedule(state: CardState, rating: Rating, now: Date = new Date()): ScheduleResult {
  return state.mode === 'fsrs' ? scheduleFsrs(state, rating, now) : scheduleEbbinghaus(state, rating, now);
}

/**
 * 模式切换时迁移历史进度（近似映射，保证切换不丢学习痕迹）：
 * - 艾宾浩斯 → FSRS：级别越高稳定性越高
 * - FSRS → 艾宾浩斯：按稳定性反推所在级别档位
 */
export function migrateCardState(state: CardState, targetMode: ScheduleMode): CardState {
  if (state.mode === targetMode || state.stage == null) {
    return { ...state, mode: targetMode };
  }

  if (targetMode === 'fsrs') {
    // stage 0..8 → stability 约 0.1..45 天
    const stability = Math.max(0.1, Math.min(45, Math.pow(2.05, state.stage)));
    return { ...state, mode: targetMode, stability };
  }

  // FSRS → 艾宾浩斯：stability 反推级别档位（正向映射为 2.05^stage，这里取其对数逆）
  const s = state.stability ?? 0;
  let stage = 0;
  if (s > 0) {
    const approx = Math.round(Math.log(Math.max(s, 0.25)) / Math.log(2.05));
    stage = Math.max(0, Math.min(8, approx));
  }
  return { ...state, mode: targetMode, stage, stability: null, fsrsDifficulty: null };
}
