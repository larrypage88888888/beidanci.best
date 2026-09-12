import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * 核心数据模型（设计文档 §六，D1/SQLite）
 * 时间统一存 ISO8601 UTC 文本；JSON 字段为序列化数组/对象。
 */

/** 词书 */
export const wordbooks = sqliteTable('wordbooks', {
  id: text('id').primaryKey(), // 如 "cet4"
  name: text('name').notNull(),
  levelTag: text('level_tag').notNull(), // 如 "CET-4"
  version: integer('version').notNull().default(1),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

/** 词条（跨词书共享；difficulty 由归一化管道懒计算写回） */
export const words = sqliteTable(
  'words',
  {
    id: text('id').primaryKey(), // 稳定 id = 单词文本
    text: text('text').notNull().unique(),
    phonetic: text('phonetic'),
    definitionsJson: text('definitions_json').notNull().default('[]'), // [{pos,meaning}]
    example: text('example'), // 英文例句（含目标词原形，供卡片高亮展示）
    exampleZh: text('example_zh'), // 例句中文翻译
    audioUrl: text('audio_url'), // M1 接入 R2
    difficulty: real('difficulty'), // NULL = 待懒计算
    cefr: text('cefr'),
    frequencyRank: integer('frequency_rank'),
    tagsJson: text('tags_json').notNull().default('[]'), // ["cet4"]
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_words_difficulty').on(t.difficulty),
    index('idx_words_cefr').on(t.cefr),
  ],
);

/** 用户 */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  nickname: text('nickname').notNull(),
  passwordHash: text('password_hash').notNull(), // pbkdf2$iterations$salt$hash
  /** 能力估计：难度轴 0..100，摸底测试后写入 */
  level: real('level').notNull().default(50),
  goalBookId: text('goal_book_id'),
  dailyNewLimit: integer('daily_new_limit').notNull().default(10),
  /** 调度模式：ebbinghaus(默认) | fsrs */
  scheduleMode: text('schedule_mode').notNull().default('ebbinghaus'),
  settingsJson: text('settings_json').notNull().default('{}'),
  placementDone: integer('placement_done', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

/** 用户×词条 记忆状态（服务端权威） */
export const userWordStates = sqliteTable(
  'user_word_states',
  {
    userId: text('user_id').notNull(),
    wordId: text('word_id').notNull(),
    /** 艾宾浩斯：当前级别 0..8，毕业=9；未学过为 NULL */
    stage: integer('stage'),
    stability: real('stability'), // FSRS 模式专用
    fsrsDifficulty: real('fsrs_difficulty'), // FSRS 模式专用
    dueAt: text('due_at'),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReviewAt: text('last_review_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.wordId] }),
    index('idx_uws_due').on(t.userId, t.dueAt),
  ],
);

/** 复习日志（只追加事件流，算法调优原料） */
export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    wordId: text('word_id').notNull(),
    rating: text('rating').notNull(), // forgot | fuzzy | remembered
    latencyMs: integer('latency_ms'),
    reviewedAt: text('reviewed_at').notNull(),
  },
  (t) => [index('idx_review_logs_user_time').on(t.userId, t.reviewedAt)],
);

/** 每日计划（Cron 预物化 / 首次访问现算兜底） */
export const dailyPlans = sqliteTable(
  'daily_plans',
  {
    userId: text('user_id').notNull(),
    date: text('date').notNull(), // YYYY-MM-DD (UTC)
    newWordIdsJson: text('new_word_ids_json').notNull().default('[]'),
    reviewWordIdsJson: text('review_word_ids_json').notNull().default('[]'),
    orderJson: text('order_json').notNull().default('[]'),
    materializedAt: text('materialized_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/** 每日统计（streak 数据源） */
export const dailyStats = sqliteTable(
  'daily_stats',
  {
    userId: text('user_id').notNull(),
    date: text('date').notNull(),
    newLearned: integer('new_learned').notNull().default(0),
    reviewed: integer('reviewed').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/** 徽章成就 */
export const achievements = sqliteTable(
  'achievements',
  {
    userId: text('user_id').notNull(),
    badgeKey: text('badge_key').notNull(),
    unlockedAt: text('unlocked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeKey] })],
);
