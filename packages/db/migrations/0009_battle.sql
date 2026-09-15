-- 0009_battle: 卡牌对战 PVE 词灵 BOSS 战（用户需求 · 预留 PVP mode）
-- 玩法：10 题，答对打 BOSS（连击加成伤害），答错被反击扣血；胜利得积分 + 抽卡次数 + 限定卡掉落。

CREATE TABLE IF NOT EXISTS boss_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT,
  theme TEXT NOT NULL,             -- 'root' | 'spell' | 'vocab'（决定掉落词池）
  difficulty INTEGER NOT NULL DEFAULT 1,
  hp INTEGER NOT NULL DEFAULT 12,
  reward_points INTEGER NOT NULL DEFAULT 30,
  reward_rarity TEXT NOT NULL DEFAULT 'SSR',  -- SR | SSR | UR
  description TEXT
);

-- 3 个词灵 BOSS 种子
INSERT OR REPLACE INTO boss_events (id, name, emoji, theme, difficulty, hp, reward_points, reward_rarity, description) VALUES
  ('root_elder',  '词根长老', '🧙', 'root',  1, 12, 30, 'SSR', '镇守词根家族图鉴的长者，击败它可得词根家族限定卡'),
  ('spell_devil', '拼写魔王', '👹', 'spell', 2, 14, 40, 'SSR', '长词拼写的地狱试炼，击败它可得拼写挑战限定卡'),
  ('vocab_tyrant','词汇暴君', '🐲', 'vocab', 3, 16, 50, 'UR',  '高频词的终极考验，击败它可得 UR 限定卡');

CREATE TABLE IF NOT EXISTS user_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  boss_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'pve',        -- 预留 'pvp'
  status TEXT NOT NULL DEFAULT 'pending', -- pending | finished
  state_json TEXT NOT NULL,               -- 进行中的题目序列与血量
  result TEXT,                            -- win | lose
  player_hp INTEGER,
  boss_hp INTEGER,
  correct INTEGER NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_word_id TEXT,
  reward_rarity TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_battles_user ON user_battles (user_id, id);

CREATE TABLE IF NOT EXISTS user_boss_daily (
  user_id TEXT NOT NULL,
  boss_id TEXT NOT NULL,
  date TEXT NOT NULL,
  won INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, boss_id, date)
);

-- 每日 BOSS 胜利数（抽卡资格加成）
ALTER TABLE daily_stats ADD COLUMN battle_wins INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '9');
