#!/usr/bin/env node
/**
 * 从 src/data/cet4-examples.json 生成 packages/db/migrations/0004_seed_examples.sql
 * （幂等 UPDATE 语句，可对本地与远程 D1 重复执行）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(readFileSync(join(here, '../src/data/cet4-examples.json'), 'utf8'));

const q = (s) => `'${s.replace(/'/g, "''")}'`;
const lines = ['-- 0004：为 CET-4 种子词写入例句（幂等，可重复执行）'];
for (const [text, v] of Object.entries(examples)) {
  lines.push(`UPDATE words SET example = ${q(v.en)}, example_zh = ${q(v.zh)} WHERE text = ${q(text)};`);
}
const out = join(here, '../../../packages/db/migrations/0004_seed_examples.sql');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`已生成 ${out}（${lines.length - 1} 条 UPDATE）`);
