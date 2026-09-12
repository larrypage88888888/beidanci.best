#!/usr/bin/env node
/**
 * 种子脚本：把 src/data/cet4-words.json 生成为 D1 可执行的 SQL。
 * 用法：node scripts/gen-seed-sql.mjs
 * 产物：../../packages/db/migrations/0002_seed_cet4.sql
 *
 * 说明：difficulty 留 NULL，由服务端归一化管道（@app/core computeDifficulty）
 *       在首次读取时懒计算并写回 —— 保证算法热修后旧数据可一键重算。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = join(here, '../src/data/cet4-words.json');
const outPath = join(here, '../../../packages/db/migrations/0002_seed_cet4.sql');

/** @returns {string} */
function sqlString(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const words = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!Array.isArray(words) || words.length === 0) {
  throw new Error('cet4-words.json 为空或格式不对');
}

const lines = [];
lines.push('-- 0002_seed_cet4: 示例词书「CET-4 核心百词」');
lines.push('-- 由 apps/server/scripts/gen-seed-sql.mjs 生成，请勿手改；difficulty 留空由管道懒计算。');
lines.push('');
lines.push(
  `INSERT OR REPLACE INTO wordbooks (id, name, level_tag, version, description, created_at) VALUES (` +
    `'cet4', 'CET-4 核心百词', 'CET-4', 1, '示例词书：覆盖 A2-C1 难度带的一百个四级核心词', ${sqlString(new Date().toISOString())});`,
);
lines.push('');

for (const w of words) {
  const id = w.text.toLowerCase();
  lines.push(
    `INSERT OR REPLACE INTO words (id, text, phonetic, definitions_json, audio_url, difficulty, cefr, frequency_rank, tags_json, created_at) VALUES (` +
      `${sqlString(id)}, ${sqlString(w.text)}, ${sqlString(w.phonetic)}, ` +
      `${sqlString(JSON.stringify(w.definitions))}, NULL, NULL, ` +
      `${sqlString(w.cefr)}, ${w.frequencyRank ?? 'NULL'}, ${sqlString(JSON.stringify(w.tags ?? ['cet4']))}, ` +
      `${sqlString(new Date().toISOString())});`,
  );
}

writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`OK 已生成 ${outPath}（${words.length} 个词条）`);
