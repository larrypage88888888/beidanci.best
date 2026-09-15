-- 0010 炉石式卡牌对战：BOSS 血量升级为英雄生命（30/35/40）
-- 说明：卡牌对战从「血条 BOSS（12/14/16）」升级为炉石式英雄对决，
--       boss_events.hp 语义变为「英雄生命值」，由服务端状态机使用。
-- 幂等：可重复执行。

UPDATE boss_events SET hp = 30 WHERE id = 'root_elder';
UPDATE boss_events SET hp = 35 WHERE id = 'spell_devil';
UPDATE boss_events SET hp = 40 WHERE id = 'vocab_tyrant';

INSERT INTO app_meta (key, value) VALUES ('schema_version', '10')
  ON CONFLICT(key) DO UPDATE SET value = '10';
