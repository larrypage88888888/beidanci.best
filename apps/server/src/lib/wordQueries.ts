import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { and, asc, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';
import { words } from '@app/db';

/**
 * 摸底候选池查询：从词库挑一批「难度贴近当前估计」的未问过的词。
 * 服务端出题（设计文档 §四.2），客户端只负责展示。
 */
export async function loadPlacementCandidates(
  db: DrizzleD1Database,
  opts: { estimate: number; excludeIds: string[]; limit?: number },
): Promise<Array<{ id: string; text: string; difficulty: number }>> {
  const conditions = [isNotNull(words.difficulty)];
  if (opts.excludeIds.length > 0) {
    conditions.push(notInArray(words.id, opts.excludeIds));
  }
  // 贴近估计值的窗口 ±20，不足时放宽到全库
  const window = 20;
  const near = await db
    .select({ id: words.id, text: words.text, difficulty: words.difficulty })
    .from(words)
    .where(
      and(
        ...conditions,
        gte(words.difficulty, Math.max(0, opts.estimate - window)),
        lte(words.difficulty, Math.min(100, opts.estimate + window)),
      ),
    )
    .orderBy(sql`abs(${words.difficulty} - ${opts.estimate})`)
    .limit(opts.limit ?? 30);

  if (near.length >= 5) {
    return near.map((r) => ({ id: r.id, text: r.text, difficulty: r.difficulty ?? 50 }));
  }

  // 放宽：按距离排序取最近的
  const relaxed = await db
    .select({ id: words.id, text: words.text, difficulty: words.difficulty })
    .from(words)
    .where(and(...conditions))
    .orderBy(sql`abs(${words.difficulty} - ${opts.estimate})`, asc(words.text))
    .limit(opts.limit ?? 30);
  return relaxed.map((r) => ({ id: r.id, text: r.text, difficulty: r.difficulty ?? 50 }));
}

/** 批量查词（组单详情 / 干扰项） */
export async function loadWordsByIds(db: DrizzleD1Database, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: words.id,
      text: words.text,
      phonetic: words.phonetic,
      definitionsJson: words.definitionsJson,
      example: words.example,
      exampleZh: words.exampleZh,
      difficulty: words.difficulty,
      cefr: words.cefr,
      frequencyRank: words.frequencyRank,
      audioUrl: words.audioUrl,
    })
    .from(words)
    .where(inArray(words.id, ids));
}
