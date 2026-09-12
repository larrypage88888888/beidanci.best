/**
 * @app/core —— 共享核心包
 * 调度引擎、难度轴、摸底测试、每日组单、题型工厂。
 * web 与 server 都从这里 import，保证两端计算结果一致。
 */

// 类型与常量
export type {
  CardState,
  ScheduleResult,
  Rating,
  ScheduleMode,
  CefrLevel,
  WordMeta,
  WordDefinition,
} from './types';
export { SCHEDULE_MODES, isRating, isScheduleMode } from './types';

// 艾宾浩斯调度
export {
  EBBINGHAUS_STAGE_INTERVALS_MIN,
  GRADUATED_STAGE,
  stageIntervalMinutes,
  newEbbinghausState,
  scheduleEbbinghaus,
  describeStage,
} from './ebbinghaus';

// FSRS-lite 调度（M1 换完整 FSRS）
export {
  FSRS_INITIAL_DIFFICULTY,
  stabilityToIntervalDays,
  newFsrsState,
  scheduleFsrs,
} from './fsrsLite';

// 统一调度入口
export { createInitialState, schedule, migrateCardState } from './scheduler';

// 统一难度轴
export {
  frequencyScore,
  complexityScore,
  computeDifficulty,
  difficultyToCefr,
  levelBand,
} from './difficulty';

// 自适应摸底
export type { PlacementSession, PlacementResult } from './placement';
export {
  PLACEMENT_MAX_QUESTIONS,
  startPlacement,
  pickPlacementWord,
  answerPlacement,
  finishPlacement,
  isPlacementDone,
  estimateVocabSize,
} from './placement';

// 每日组单
export type { DailyQueueInput, DailyQueue } from './dailyQueue';
export { mulberry32, shuffleSeeded, buildDailyQueue, remainingNewQuota } from './dailyQueue';

// streak 打卡
export { todayKey, toDateKey, computeStreak, longestStreak } from './streak';

// 题型工厂
export type { QuestionKind, QuizQuestion, ChoiceOption } from './quizFactory';
export {
  M0_QUESTION_KINDS,
  renderDefinitions,
  pickDistractors,
  generateQuestion,
  maskWord,
  normalizeAnswer,
  checkSpelling,
  kindForIndex,
  hashSeed,
} from './quizFactory';
