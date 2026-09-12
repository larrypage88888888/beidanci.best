/**
 * @app/core 共享领域类型
 * web 与 server 复用同一份调度引擎的契约层。
 */

/** 作答反馈三档（设计文档 §4.3） */
export type Rating = 'forgot' | 'fuzzy' | 'remembered';

/** 调度模式：艾宾浩斯经典（默认） / FSRS 智能 */
export type ScheduleMode = 'ebbinghaus' | 'fsrs';

export const SCHEDULE_MODES: readonly ScheduleMode[] = ['ebbinghaus', 'fsrs'] as const;

function isScheduleMode(v: unknown): v is ScheduleMode {
  return v === 'ebbinghaus' || v === 'fsrs';
}

/** CEFR 等级 */
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/**
 * 服务端权威的单词条记忆状态（对应 D1 表 user_word_states 的领域镜像）。
 * 客户端只读镜像用于乐观预渲染，一切以服务端回写结果为准。
 */
export interface CardState {
  wordId: string;
  mode: ScheduleMode;
  /** 艾宾浩斯：当前级别 0..8，毕业=9；未学过为 null */
  stage: number | null;
  /** FSRS 模式专用：记忆稳定性（天） */
  stability: number | null;
  /** FSRS 模式专用：条目难度 1..10 */
  fsrsDifficulty: number | null;
  /** 下次到期时间 ISO8601；毕业词为 null */
  dueAt: string | null;
  /** 累计作答次数 */
  reps: number;
  /** 累计遗忘次数 */
  lapses: number;
  /** 最近一次作答时间 ISO8601 */
  lastReviewAt: string | null;
}

/** 调度结果 */
export interface ScheduleResult {
  next: CardState;
  /** 本次作答后是否毕业 */
  graduated: boolean;
  /** 距下次复习的间隔分钟数；毕业为 null */
  intervalMinutes: number | null;
}

/** 词条元数据（组单/出题用） */
export interface WordMeta {
  id: string;
  text: string;
  phonetic?: string;
  /** 释义列表，如 [{pos:'n.', meaning:'苹果'}] */
  definitions?: WordDefinition[];
  /** 英文例句（含目标词）与中文翻译，随题下发供卡片展示 */
  example?: string;
  exampleZh?: string;
  cefr?: CefrLevel;
  frequencyRank?: number;
  /** 统一难度轴 0..100 */
  difficulty?: number;
  tags?: string[];
}

export interface WordDefinition {
  pos?: string;
  meaning: string;
}

export function isRating(v: unknown): v is Rating {
  return v === 'forgot' || v === 'fuzzy' || v === 'remembered';
}

export { isScheduleMode };
