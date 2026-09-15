import { Hono } from 'hono';
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { dailyStats, userWordStates, users } from '@app/db';
import { buildDailyQueue, computeStreak, hashSeed, remainingNewQuota } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { dateKeyUtc, nowIso } from '../lib/time';
import { getOrBuildTodayPlan } from '../lib/todayBuilder';
import { loadWordsByIds } from '../lib/wordQueries';
import { ensureWordDifficulties } from '../lib/difficultyPipeline';
import { getDb } from '../lib/db';

/**
 * GET /api/today —— 今日学习队列（动态到期驱动，艾宾浩斯核心）
 *
 * 队列 = 到期复习词（due_at <= now，含今天刚学、5/30 分钟后到期的快闪轮次）
 *      ∪ 今日计划新词中「从未学过」的（学过一次后改走到期通道回归）
 *
 * 不再按「今天答过」剔除 —— 艾宾浩斯的意义就是让词在同一天多次回来。
 * 毕业词（due_at 为 NULL）自然排除；刚答完的词因 due_at 在未来也不会立即重复。
 */
export const todayRoutes = new Hono<AppEnv>();
todayRoutes.use('*', requireAuth);

todayRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const date = dateKeyUtc();
  const db = getDb(c.env);

  await ensureWordDifficulties(db);

  const plan = await getOrBuildTodayPlan(db, userId, date);
  if (!plan) return c.json({ error: 'not_found', message: '用户不存在' }, 404);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [stats] = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)))
    .limit(1);

  // ── 1) 到期复习通道：权威状态里所有到期的词 ──
  const nowIsoStr = nowIso();
  const dueRows = await db
    .select({ wordId: userWordStates.wordId, stage: userWordStates.stage, dueAt: userWordStates.dueAt })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        isNotNull(userWordStates.dueAt),
        lte(userWordStates.dueAt, nowIsoStr),
        or(isNull(userWordStates.stage), ne(userWordStates.stage, 9)),
      ),
    )
    .orderBy(asc(userWordStates.dueAt))
    .limit(300);

  // ── 2) 新词通道：今日计划的新词里还没学过的 ──
  let freshNew = plan.newWordIds;
  if (freshNew.length > 0) {
    const stateRows = await db
      .select({ wordId: userWordStates.wordId })
      .from(userWordStates)
      .where(and(eq(userWordStates.userId, userId), inArray(userWordStates.wordId, freshNew)));
    const seen = new Set(stateRows.map((r) => r.wordId));
    freshNew = freshNew.filter((id) => !seen.has(id));
  }

  // 按当前上限的剩余新词额度钳制（设置里改上限后立即生效，已学超过上限则不再补新词）
  const limit = user?.dailyNewLimit ?? 10;
  const used = stats?.newLearned ?? 0;
  const remainingQuota = remainingNewQuota(limit, used);
  if (remainingQuota < freshNew.length) freshNew = freshNew.slice(0, Math.max(0, remainingQuota));

  // ── 3) 组单：到期词洗牌热身 + 未学新词穿插 ──
  const queue = buildDailyQueue({
    candidateNewWordIds: freshNew,
    dueReviewWordIds: dueRows.map((r) => r.wordId),
    newLimit: freshNew.length,
    seed: hashSeed(`${userId}:${date}:dyn`),
  });
  const remaining = queue.order;

  // 剩余词详情（含释义 JSON 解析）；标注每题是新词还是复习（艾宾浩斯回归）
  const dueMap = new Map(dueRows.map((r) => [r.wordId, r]));
  const wordRows = await loadWordsByIds(db, remaining);
  const items = wordRows.map((w) => {
    const dueInfo = dueMap.get(w.id);
    return {
      id: w.id,
      text: w.text,
      phonetic: w.phonetic ?? undefined,
      definitions: JSON.parse(w.definitionsJson || '[]'),
      example: w.example ?? undefined,
      exampleZh: w.exampleZh ?? undefined,
      difficulty: w.difficulty ?? undefined,
      cefr: w.cefr ?? undefined,
      audioUrl: w.audioUrl ?? undefined,
      entry: (dueInfo ? 'review' : 'new') as 'review' | 'new',
      /** 复习题当前的艾宾浩斯级别（展示进度条用） */
      reviewStage: dueInfo?.stage ?? undefined,
    };
  });
  const reviewCount = items.filter((i) => i.entry === 'review').length;

  // streak 与今日统计
  const statRows = await db.select({ date: dailyStats.date }).from(dailyStats).where(eq(dailyStats.userId, userId));
  const streak = computeStreak(statRows.map((r) => r.date));

  return c.json({
    date,
    scheduleMode: user?.scheduleMode ?? 'ebbinghaus',
    level: user?.level ?? 50,
    streak,
    stats: {
      newLearned: stats?.newLearned ?? 0,
      reviewed: stats?.reviewed ?? 0,
      totalCount: stats?.totalCount ?? 0,
      correctRate:
        stats && stats.totalCount > 0 ? Math.round((stats.correctCount / stats.totalCount) * 100) : null,
    },
    newQuota: {
      limit: user?.dailyNewLimit ?? 10,
      used: stats?.newLearned ?? 0,
      remaining: remainingNewQuota(user?.dailyNewLimit ?? 10, stats?.newLearned ?? 0),
    },
    reviewCount,
    newCount: items.length - reviewCount,
    fullOrder: remaining,
    remainingOrder: remaining,
    items,
  });
});
