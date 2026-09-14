-- 0006_gamification: 趣味化 P0（设计文档 §十）
-- 连击纪录 / 词苗养成 / 词卡抽卡 / 词力积分 / 道具库存

CREATE TABLE IF NOT EXISTS user_pets (
  user_id TEXT PRIMARY KEY,
  stage_idx INTEGER NOT NULL DEFAULT 0,
  tree_age_days INTEGER NOT NULL DEFAULT 0,
  last_water_at TEXT NOT NULL,
  wilt_since TEXT,
  revive_deadline TEXT,
  wilted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_cards (
  user_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  obtained_at TEXT NOT NULL,
  PRIMARY KEY (user_id, word_id)
);

CREATE TABLE IF NOT EXISTS user_points (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_type)
);

-- daily_stats 扩展：当日最高连击 / 当日已抽卡次数
ALTER TABLE daily_stats ADD COLUMN max_combo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_stats ADD COLUMN cards_drawn INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '6');
