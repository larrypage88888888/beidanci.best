import { Hono } from 'hono';
import { and, asc, desc, eq, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { userWordStates, words } from '@app/db';
import { requireAuth } from '../middleware/auth';
import { nowIso } from '../lib/time';
import { getDb } from '../lib/db';

/**
 * GET /api/words —— 我的词库：所有已学单词 + 艾宾浩斯记忆状态。
 *
 * 查询参数：
 *   filter   = all | learning | graduated | due   （默认 all）
 *   sort     = recent | stage | alpha             （默认 recent 最近作答优先）
 *   page     = 1..                                （默认 1）
 *   pageSize = 5..100                             （默认 20）
 */
export const myWordsRoutes = new Hono<AppEnv>();
myWordsRoutes.use('*', requireAuth);

const QuerySchema = z.object({
  filter: z.enum(['all', 'learning', 'graduated', 'due']).default('all'),
  sort: z.enum(['recent', 'stage', 'alpha']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

const GRADUATED_STAGE = 9;

myWordsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  const parsed = QuerySchema.safeParse(c.req.query());
  const { filter, sort, page, pageSize } = parsed.success ? parsed.data : { filter: 'all' as const, sort: 'recent' as const, page: 1, pageSize: 20 };

  const nowIsoStr = nowIso();

  /* ── 汇总统计 ── */
  const [totals] = await db
    .select({
      total: sql<number>`count(*)`,
      graduated: sql<number>`sum(case when ${userWordStates.stage} = ${GRADUATED_STAGE} then 1 else 0 end)`,
      due: sql<number>`sum(case when ${userWordStates.dueAt} is not null and ${userWordStates.dueAt} <= ${nowIsoStr} and (${userWordStates.stage} is null or ${userWordStates.stage} != ${GRADUATED_STAGE}) then 1 else 0 end)`,
    })
    .from(userWordStates)
    .where(eq(userWordStates.userId, userId));

  const total = Number(totals?.total ?? 0);
  const graduated = Number(totals?.graduated ?? 0);
  const due = Number(totals?.due ?? 0);

  /* ── 列表查询 ── */
  const conds = [eq(userWordStates.userId, userId)];
  if (filter === 'graduated') {
    conds.push(eq(userWordStates.stage, GRADUATED_STAGE));
  } else if (filter === 'learning') {
    conds.push(or(isNull(userWordStates.stage), ne(userWordStates.stage, GRADUATED_STAGE))!);
  } else if (filter === 'due') {
    conds.push(isNotNull(userWordStates.dueAt));
    conds.push(lte(userWordStates.dueAt, nowIsoStr));
    conds.push(or(isNull(userWordStates.stage), ne(userWordStates.stage, GRADUATED_STAGE))!);
  }

  const orderBy =
    sort === 'stage'
      ? [desc(userWordStates.stage), desc(userWordStates.lastReviewAt)]
      : sort === 'alpha'
        ? [asc(words.text)]
        : [desc(userWordStates.lastReviewAt)];

  const rows = await db
    .select({
      wordId: userWordStates.wordId,
      stage: userWordStates.stage,
      stability: userWordStates.stability,
      dueAt: userWordStates.dueAt,
      reps: userWordStates.reps,
      lapses: userWordStates.lapses,
      lastReviewAt: userWordStates.lastReviewAt,
      text: words.text,
      phonetic: words.phonetic,
      definitionsJson: words.definitionsJson,
      example: words.example,
      exampleZh: words.exampleZh,
      cefr: words.cefr,
      difficulty: words.difficulty,
    })
    .from(userWordStates)
    .innerJoin(words, eq(userWordStates.wordId, words.id))
    .where(and(...conds))
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map((r) => ({
    wordId: r.wordId,
    text: r.text,
    phonetic: r.phonetic ?? undefined,
    definitions: JSON.parse(r.definitionsJson || '[]'),
    example: r.example ?? undefined,
    exampleZh: r.exampleZh ?? undefined,
    cefr: r.cefr ?? undefined,
    stage: r.stage,
    stability: r.stability ?? undefined,
    dueAt: r.dueAt,
    reps: r.reps,
    lapses: r.lapses,
    lastReviewAt: r.lastReviewAt,
    status: ((): 'graduated' | 'due' | 'learning' => {
      if (r.stage === GRADUATED_STAGE) return 'graduated';
      if (r.dueAt != null && r.dueAt <= nowIsoStr) return 'due';
      return 'learning';
    })(),
  }));

  return c.json({
    total,
    learning: Math.max(0, total - graduated),
    graduated,
    due,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    items,
  });
});
