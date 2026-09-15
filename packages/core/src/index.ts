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

// 趣味化 P0（§十）：连击 / 词苗养成 / 词卡抽卡
export type { ComboState, PetRow, PetUpdateResult, CardRarity } from './gamification';
export {
  newCombo,
  nextCombo,
  comboLevel,
  PET_STAGES,
  petStageForAge,
  REVIVE_WORD_COST,
  shiftDateKey,
  daysBetween,
  updatePet,
  CARD_RARITY_WEIGHTS,
  DUPLICATE_POINTS,
  CARD_ANSWER_THRESHOLD,
  CARD_COMBO_EXTRA,
  rollCardRarity,
  cardDrawAllowance,
} from './gamification';

// C10 段位（§10.3）
export type { RankTier, RankInput, RankInfo } from './rank';
export {
  RANK_TIERS,
  RANK_TIER_EMOJI,
  RANK_TIER_THRESHOLDS,
  computeRankScore,
  tierForScore,
  rankInfo,
  seasonKey,
  isSeasonSettleDay,
} from './rank';

// 卡牌对战 PVE（词灵 BOSS 战）
export type { BattleResult, BattleOutcomeInput, BuildBattleWordsInput } from './battle';
export {
  BATTLE_QUESTION_COUNT,
  PLAYER_MAX_HP,
  damageForCombo,
  battleOutcome,
  buildBattleWords,
} from './battle';

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
