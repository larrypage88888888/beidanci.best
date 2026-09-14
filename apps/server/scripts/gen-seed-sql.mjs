#!/usr/bin/env node
/**
 * 种子生成器：把 src/data/<book>-words.json 生成为 D1 可执行的 SQL。
 * 用法：node scripts/gen-seed-sql.mjs [bookId] [minTier] [outFile] [includeMinTier]
 *   默认：bookId=cet4 minTier=0 outFile=0002_seed_cet4.sql includeMinTier=false
 *   示例（CET-6 高阶词书，黄金段解锁）：
 *     node scripts/gen-seed-sql.mjs cet6 3 0008_seed_cet6.sql true
 *
 * 说明：difficulty 留 NULL，由服务端归一化管道（@app/core computeDifficulty）
 *       在首次读取时懒计算并写回 —— 保证算法热修后旧数据可一键重算。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [,, bookIdArg, minTierArg, outArg, includeMinTierArg] = process.argv;
const bookId = bookIdArg ?? 'cet4';
const minTier = Number(minTierArg ?? 0);
const outFile = outArg ?? `0002_seed_${bookId}.sql`;
const includeMinTier = includeMinTierArg === 'true';

const BOOK_META = {
  cet4: {
    name: 'CET-4 核心词',
    levelTag: 'CET-4',
    description: '覆盖 A2-C1 难度带的一百四十余个四级核心词（含 15 个词根家族示例词，配合词根技能树）',
  },
  cet6: {
    name: 'CET-6 进阶词',
    levelTag: 'CET-6',
    description: 'B2-C1 高阶词包：历史最高段位达到「黄金」解锁（段位系统 C10）',
  },
};

const dataPath = join(here, `../src/data/${bookId}-words.json`);
const outPath = join(here, '../../../packages/db/migrations', outFile);

/** @returns {string} */
function sqlString(v) {
  if (v == null) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

const words = JSON.parse(readFileSync(dataPath, 'utf8'));
if (!Array.isArray(words) || words.length === 0) {
  throw new Error(`${bookId}-words.json 为空或格式不对`);
}

const meta = BOOK_META[bookId];
const lines = [];
lines.push(`-- ${outFile}: 词书「${meta?.name ?? bookId}」种子`);
lines.push('-- 由 apps/server/scripts/gen-seed-sql.mjs 生成，请勿手改；difficulty 留空由管道懒计算。');
lines.push('');

const bookCols = includeMinTier
  ? '(id, name, level_tag, version, description, min_tier, created_at)'
  : '(id, name, level_tag, version, description, created_at)';
const bookVals = includeMinTier
  ? `'${bookId}', ${sqlString(meta?.name ?? bookId)}, ${sqlString(meta?.levelTag ?? bookId.toUpperCase())}, 1, ${sqlString(meta?.description ?? null)}, ${minTier}, ${sqlString(new Date().toISOString())}`
  : `'${bookId}', ${sqlString(meta?.name ?? bookId)}, ${sqlString(meta?.levelTag ?? bookId.toUpperCase())}, 1, ${sqlString(meta?.description ?? null)}, ${sqlString(new Date().toISOString())}`;
lines.push(`INSERT OR REPLACE INTO wordbooks ${bookCols} VALUES (${bookVals});`);
lines.push('');

for (const w of words) {
  const id = w.text.toLowerCase();
  lines.push(
    `INSERT OR REPLACE INTO words (id, text, phonetic, definitions_json, audio_url, difficulty, cefr, frequency_rank, tags_json, created_at) VALUES (` +
      `${sqlString(id)}, ${sqlString(w.text)}, ${sqlString(w.phonetic)}, ` +
      `${sqlString(JSON.stringify(w.definitions))}, NULL, NULL, ` +
      `${sqlString(w.cefr)}, ${w.frequencyRank ?? 'NULL'}, ${sqlString(JSON.stringify(w.tags ?? [bookId]))}, ` +
      `${sqlString(new Date().toISOString())});`,
  );
}

writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`OK 已生成 ${outPath}（${words.length} 个词条，min_tier=${minTier}${includeMinTier ? '' : '，不含 min_tier 列（0007 之前表无此列）'}）`);
