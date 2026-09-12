-- 0003：为词表补充例句字段（英文例句 + 中文句译）
ALTER TABLE words ADD COLUMN example TEXT;
ALTER TABLE words ADD COLUMN example_zh TEXT;
