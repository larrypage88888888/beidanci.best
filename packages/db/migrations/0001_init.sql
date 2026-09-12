-- 0001_init: 背单词 App「词流」初始表结构（对应 packages/db/src/schema.ts）
-- 应用方式：wrangler d1 execute wordflow-db --local --file=../../packages/db/migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS wordbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level_tag TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL UNIQUE,
  phonetic TEXT,
  definitions_json TEXT NOT NULL DEFAULT '[]',
  audio_url TEXT,
  difficulty REAL,
  cefr TEXT,
  frequency_rank INTEGER,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_words_difficulty ON words (difficulty);
CREATE INDEX IF NOT EXISTS idx_words_cefr ON words (cefr);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  level REAL NOT NULL DEFAULT 50,
  goal_book_id TEXT,
  daily_new_limit INTEGER NOT NULL DEFAULT 10,
  schedule_mode TEXT NOT NULL DEFAULT 'ebbinghaus',
  settings_json TEXT NOT NULL DEFAULT '{}',
  placement_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_word_states (
  user_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  stage INTEGER,
  stability REAL,
  fsrs_difficulty REAL,
  due_at TEXT,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_uws_due ON user_word_states (user_id, due_at);

CREATE TABLE IF NOT EXISTS review_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  latency_ms INTEGER,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_logs_user_time ON review_logs (user_id, reviewed_at);

CREATE TABLE IF NOT EXISTS daily_plans (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  new_word_ids_json TEXT NOT NULL DEFAULT '[]',
  review_word_ids_json TEXT NOT NULL DEFAULT '[]',
  order_json TEXT NOT NULL DEFAULT '[]',
  materialized_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS daily_stats (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  new_learned INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_key)
);
