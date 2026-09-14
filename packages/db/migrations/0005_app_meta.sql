-- 0005_app_meta: 数据库身份标记 —— 用于检测「换库 / 重置」（见 README 已知坑）
-- instance_id 每次初始化/重置都会是新的随机值；/api/health 暴露它，变了就说明库被换过。

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('instance_id', lower(hex(randomblob(16))));
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '5');
