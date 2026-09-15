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
  /** C10 段位解锁门槛：0 青铜起，5 词霸（best_tier ≥ min_tier 才可选） */
  minTier: integer('min_tier').notNull().default(0),
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
    /** 当日最高连击（会话内 best 的当日纪录，抽卡加成/周报用） */
    maxCombo: integer('max_combo').notNull().default(0),
    /** 当日已抽词卡次数（抽卡资格扣减） */
    cardsDrawn: integer('cards_drawn').notNull().default(0),
    /** 当日 BOSS 战胜利数（抽卡资格加成） */
    battleWins: integer('battle_wins').notNull().default(0),
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

/** 词苗养成（设计文档 §10.2 B5）——树龄 = 有学习活动的累计天数 */
export const userPets = sqliteTable('user_pets', {
  userId: text('user_id').primaryKey(),
  stageIdx: integer('stage_idx').notNull().default(0), // 0 词苗/1 小树/2 大树/3 开花
  treeAgeDays: integer('tree_age_days').notNull().default(0),
  lastWaterAt: text('last_water_at').notNull(), // YYYY-MM-DD (UTC)
  wiltSince: text('wilt_since'), // 首次断签日
  reviveDeadline: text('revive_deadline'), // 救活截止日（含）
  wilted: integer('wilted', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

/** 词卡图鉴（A2）：每人每词一张，稀有度 SR/SSR/UR */
export const userCards = sqliteTable(
  'user_cards',
  {
    userId: text('user_id').notNull(),
    wordId: text('word_id').notNull(),
    rarity: text('rarity').notNull(),
    obtainedAt: text('obtained_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.wordId] })],
);

/** 词力积分（重复词卡转换 / 兑换装饰） */
export const userPoints = sqliteTable('user_points', {
  userId: text('user_id').primaryKey(),
  balance: integer('balance').notNull().default(0),
});

/** 道具库存（P0 用：复活卡） */
export const userInventory = sqliteTable(
  'user_inventory',
  {
    userId: text('user_id').notNull(),
    itemType: text('item_type').notNull(), // 'revive_card'
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemType] })],
);

/** C10 段位（§10.3）：每月结算一次，season = YYYY-MM */
export const userSeasonRank = sqliteTable(
  'user_season_rank',
  {
    userId: text('user_id').notNull(),
    season: text('season').notNull(), // 'YYYY-MM'
    tier: integer('tier').notNull().default(0),
    score: real('score').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.season] })],
);

/** 历史最高段位（防落差打击；段位解锁依据） */
export const userRankMeta = sqliteTable('user_rank_meta', {
  userId: text('user_id').primaryKey(),
  bestTier: integer('best_tier').notNull().default(0),
  bestSeason: text('best_season'),
  updatedAt: text('updated_at').notNull(),
});

/** 词根（C9 技能树） */
export const wordRoots = sqliteTable('word_roots', {
  root: text('root').primaryKey(), // 如 'spect'
  affixType: text('affix_type').notNull(), // root | prefix | suffix
  meaning: text('meaning').notNull(),
  emoji: text('emoji'),
});

/** 词根 × 词条 映射 */
export const wordRootMap = sqliteTable(
  'word_root_map',
  {
    wordId: text('word_id').notNull(),
    root: text('root').notNull(),
  },
  (t) => [primaryKey({ columns: [t.wordId, t.root] })],
);

/* ── 卡牌对战 PVE（用户需求，预留 PVP mode） ── */

/** 词灵 BOSS 配置（内置种子） */
export const bossEvents = sqliteTable('boss_events', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  theme: text('theme').notNull(), // root | spell | vocab（掉落词池）
  difficulty: integer('difficulty').notNull().default(1),
  hp: integer('hp').notNull().default(12),
  rewardPoints: integer('reward_points').notNull().default(30),
  rewardRarity: text('reward_rarity').notNull().default('SSR'),
  description: text('description'),
});

/** 用户战斗记录（状态机：进行中 state_json → finished 结算） */
export const userBattles = sqliteTable('user_battles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  bossId: text('boss_id').notNull(),
  mode: text('mode').notNull().default('pve'), // 预留 pvp
  status: text('status').notNull().default('pending'),
  stateJson: text('state_json').notNull(),
  result: text('result'), // win | lose
  playerHp: integer('player_hp'),
  bossHp: integer('boss_hp'),
  correct: integer('correct').notNull().default(0),
  rewardPoints: integer('reward_points').notNull().default(0),
  rewardWordId: text('reward_word_id'),
  rewardRarity: text('reward_rarity'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

/** 每日每 BOSS 挑战记录（防刷限定卡） */
export const userBossDaily = sqliteTable(
  'user_boss_daily',
  {
    userId: text('user_id').notNull(),
    bossId: text('boss_id').notNull(),
    date: text('date').notNull(),
    won: integer('won').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.bossId, t.date] })],
);
