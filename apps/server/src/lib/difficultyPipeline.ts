import { eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { words } from '@app/db';
import { computeDifficulty } from '@app/core';
import type { CefrLevel } from '@app/core';

/**
 * 归一化管道（设计文档 §三·词库数据源）：
 * 给 difficulty 为 NULL 的词条统一打难度分并写回。
 * 纯函数式懒计算 —— 算法热修后把列清空即可全量重算。
 */
export async function ensureWordDifficulties(db: DrizzleD1Database, limit = 500): Promise<number> {
  const rows = await db
    .select({ id: words.id, text: words.text, cefr: words.cefr, frequencyRank: words.frequencyRank })
    .from(words)
    .where(isNull(words.difficulty))
    .limit(limit);

  if (rows.length === 0) return 0;

  const updates = rows.map((r) =>
    db
      .update(words)
      .set({
        difficulty: computeDifficulty({
          text: r.text,
          cefr: (r.cefr as CefrLevel | null) ?? undefined,
          frequencyRank: r.frequencyRank ?? undefined,
        }),
      })
      .where(eq(words.id, r.id)),
  );
  // rows.length > 0 已保证非空，满足 batch 的元组签名
  await db.batch(updates as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  return rows.length;
}
