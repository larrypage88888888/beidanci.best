-- 0007_gamification_p1: C10 段位系统 + C9 词根技能树（设计文档 §10.3）
-- 注意：词根映射依赖 0002 重新执行后的扩充词条（含新词根词），请先重跑 0002 再跑本文件。

CREATE TABLE IF NOT EXISTS user_season_rank (
  user_id TEXT NOT NULL,
  season TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, season)
);

CREATE TABLE IF NOT EXISTS user_rank_meta (
  user_id TEXT PRIMARY KEY,
  best_tier INTEGER NOT NULL DEFAULT 0,
  best_season TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_roots (
  root TEXT PRIMARY KEY,
  affix_type TEXT NOT NULL,
  meaning TEXT NOT NULL,
  emoji TEXT
);

CREATE TABLE IF NOT EXISTS word_root_map (
  word_id TEXT NOT NULL,
  root TEXT NOT NULL,
  PRIMARY KEY (word_id, root)
);

-- 词书解锁门槛（C10）：0=青铜起，5=词霸
ALTER TABLE wordbooks ADD COLUMN min_tier INTEGER NOT NULL DEFAULT 0;
UPDATE wordbooks SET min_tier = 0;

-- 15 个常用词根/词缀（M1 接全量开源词根表）
INSERT OR REPLACE INTO word_roots (root, affix_type, meaning, emoji) VALUES
  ('bio',    'root',   '生命', '🧬'),
  ('geo',    'root',   '大地', '🌍'),
  ('graph',  'root',   '写；画', '✍️'),
  ('dict',   'root',   '说',   '💬'),
  ('duct',   'root',   '引导', '🧭'),
  ('ject',   'root',   '投掷', '🎯'),
  ('port',   'root',   '运送', '🚚'),
  ('spect',  'root',   '看',   '👀'),
  ('struct', 'root',   '建造', '🏗️'),
  ('tract',  'root',   '拉；拖', '🪝'),
  ('vis',    'root',   '看',   '🔭'),
  ('form',   'root',   '形状', '🎨'),
  ('press',  'root',   '压',   '🤏'),
  ('tend',   'root',   '伸展', '🧘'),
  ('ven',    'root',   '来',   '🚶');

-- 词根 × 词条映射（只映射实际存在的词，OR IGNORE 防重复执行）
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'bio'    FROM words WHERE id IN ('biology','biography','antibiotic');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'geo'    FROM words WHERE id IN ('geography','geology','geometry');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'graph'  FROM words WHERE id IN ('paragraph','photograph','graphic');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'dict'   FROM words WHERE id IN ('contradict','predict','verdict');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'duct'   FROM words WHERE id IN ('produce','introduce','conduct');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'ject'   FROM words WHERE id IN ('project','reject','inject');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'port'   FROM words WHERE id IN ('transport','import','support');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'spect'  FROM words WHERE id IN ('inspect','respect','prospect');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'struct' FROM words WHERE id IN ('structure','construct','instruct');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'tract'  FROM words WHERE id IN ('attract','extract','contract');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'vis'    FROM words WHERE id IN ('visible','revise','evidence','evident');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'form'   FROM words WHERE id IN ('formal','transform','inform');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'press'  FROM words WHERE id IN ('express','impress','pressure');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'tend'   FROM words WHERE id IN ('extend','intend','attend');
INSERT OR IGNORE INTO word_root_map (word_id, root)
  SELECT id, 'ven'    FROM words WHERE id IN ('prevent','event','invent');

INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '7');
