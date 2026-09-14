/** 与服务端 API 响应对齐的客户端类型 */
import type { CefrLevel, ScheduleMode } from '@app/core';

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  level: number;
  goalBookId: string | null;
  dailyNewLimit: number;
  scheduleMode: ScheduleMode;
  settings: Record<string, unknown>;
  placementDone: boolean;
  createdAt: string;
}

export interface MeResponse {
  user: PublicUser;
  streak: number;
  dueCount: number;
  /** P0 趣味化（§十） */
  pet: PetInfo | null;
  points: number;
  cardsCount: number;
  reviveCards: number;
  cardDraw: CardDrawInfo;
}

export interface TodayItem {
  id: string;
  text: string;
  phonetic?: string;
  definitions: Array<{ pos?: string; meaning: string }>;
  /** 英文例句（含目标词，供卡片高亮展示） */
  example?: string;
  /** 例句中文翻译 */
  exampleZh?: string;
  difficulty?: number;
  cefr?: CefrLevel;
  audioUrl?: string;
  /** 本题来源：new=今日新词首次学习；review=按艾宾浩斯曲线到期的复习 */
  entry?: 'new' | 'review';
  /** 复习题当前的艾宾浩斯级别 0..8 */
  reviewStage?: number;
}

export interface TodayResponse {
  date: string;
  scheduleMode: 'ebbinghaus' | 'fsrs';
  level: number;
  streak: number;
  stats: {
    newLearned: number;
    reviewed: number;
    totalCount: number;
    correctRate: number | null;
  };
  newQuota: { limit: number; used: number; remaining: number };
  /** 本次队列中复习题 / 新词题数量 */
  reviewCount: number;
  newCount: number;
  fullOrder: string[];
  remainingOrder: string[];
  items: TodayItem[];
}

export interface ReviewResult {
  wordId: string;
  stage: number | null;
  stability: number | null;
  fsrsDifficulty: number | null;
  dueAt: string | null;
  reps: number;
  graduated: boolean;
  intervalMinutes: number | null;
}

export interface ReviewsResponse {
  results: ReviewResult[];
  streak: number;
  unlockedBadges: string[];
  /** P0 趣味化（§十） */
  pet?: PetInfo | null;
  cardDraw?: CardDrawInfo;
  todayMaxCombo?: number;
  reviveCards?: number;
}

export interface PlacementQuestion {
  wordId: string;
  text: string;
}

export interface PlacementResult {
  level: number;
  vocabEstimate: number;
  cefr: string;
  correctCount: number;
  questionCount: number;
}

export interface Wordbook {
  id: string;
  name: string;
  levelTag: string;
  version: number;
  description: string | null;
}

/* ── 我的词库 ── */
export interface MyWordItem {
  wordId: string;
  text: string;
  phonetic?: string;
  definitions: Array<{ pos?: string; meaning: string }>;
  example?: string;
  exampleZh?: string;
  cefr?: string;
  /** 艾宾浩斯级别 0..8，毕业=9，未学=null（理论不会出现在词库） */
  stage: number | null;
  stability?: number;
  dueAt: string | null;
  reps: number;
  lapses: number;
  lastReviewAt: string | null;
  status: 'learning' | 'graduated' | 'due';
}

export interface MyWordsResponse {
  total: number;
  learning: number;
  graduated: number;
  due: number;
  page: number;
  pageSize: number;
  pages: number;
  items: MyWordItem[];
}

/* ── P0 趣味化：词苗 / 词卡抽卡（§十） ── */
export interface PetInfo {
  stageIdx: number;
  stageLabel: string;
  emoji: string;
  treeAgeDays: number;
  wilted: boolean;
  reviveDeadline: string | null;
  /** 枯萎中：距「学 5 词」自动救活还差几题（0 = 本次已满足） */
  needsWords?: number;
  revived?: boolean;
  hardReset?: boolean;
}

export interface CardDrawInfo {
  eligible: number;
  remaining: number;
}

export type CardRarity = 'SR' | 'SSR' | 'UR';

export interface CardItem {
  wordId: string;
  text: string;
  phonetic?: string;
  definitions: Array<{ pos?: string; meaning: string }>;
  rarity: CardRarity;
  obtainedAt: string;
}

export interface CollectionResponse {
  items: CardItem[];
  counts: { SR: number; SSR: number; UR: number; total: number };
  points: number;
  draw: CardDrawInfo;
}

export interface DrawResponse {
  card: CardItem & { duplicate: boolean; pointsGained?: number };
  remaining: number;
}
