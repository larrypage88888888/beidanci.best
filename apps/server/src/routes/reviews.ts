import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { achievements, dailyStats, reviewLogs, userWordStates, users } from '@app/db';
import { computeStreak, isRating, schedule } from '@app/core';
import type { CardState, Rating } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { randomId } from '../lib/jwt';
import { dateKeyUtc, nowIso } from '../lib/time';
import { getDb } from '../lib/db';

/**
 * POST /api/reviews —— 批量回写作答，权威调度（设计文档 §六 API 面）：
 *   1. 按 users.schedule_mode 用 @app/core 调度器计算每个词的下一状态
 *   2. upsert user_word_states + 追加 review_logs（单次 D1 batch）
 *   3. 累加 daily_stats、解锁成就、计算 streak
 *   4. 返回权威结果供客户端校正乐观镜像
 */
export const reviewsRoutes = new Hono<AppEnv>();
reviewsRoutes.use('*', requireAuth);

const ReviewItemSchema = z.object({
  wordId: z.string().min(1),
  rating: z.custom<Rating>((v) => isRating(v), 'rating 必须是 forgot|fuzzy|remembered'),
  // 遥测字段不做硬上限拒绝：用户可能在某题停留很久；入库前统一钳制
  latencyMs: z.number().int().nonnegative().optional(),
});
const BatchSchema = z.object({
  items: z.array(ReviewItemSchema).min(1).max(100),
});

reviewsRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = BatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const { items } = parsed.data;
  const db = getDb(c.env);

  // 用户当前调度模式（状态行不存模式列，统一按当前模式解释）
  const [user] = await db
    .select({ scheduleMode: users.scheduleMode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return c.json({ error: 'not_found', message: '用户不存在' }, 404);
  const mode = user.scheduleMode === 'fsrs' ? 'fsrs' : 'ebbinghaus';

  const wordIds = [...new Set(items.map((i) => i.wordId))];
  const existingRows = await db
    .select()
    .from(userWordStates)
    .where(and(eq(userWordStates.userId, userId), inArray(userWordStates.wordId, wordIds)));
  const existingMap = new Map(existingRows.map((r) => [r.wordId, r]));

  const now = new Date();
  const nowStr = now.toISOString();
  const date = dateKeyUtc(now);

  let newLearnedDelta = 0;
  let reviewedDelta = 0;
  let correctDelta = 0;
  const results: Array<{
    wordId: string;
    stage: number | null;
    stability: number | null;
    fsrsDifficulty: number | null;
    dueAt: string | null;
    reps: number;
    graduated: boolean;
    intervalMinutes: number | null;
  }> = [];

  const stmts: BatchItem<'sqlite'>[] = [];

  for (const item of items) {
    const row = existingMap.get(item.wordId);
    const state: CardState = {
      wordId: item.wordId,
      mode,
      stage: row?.stage ?? null,
      stability: row?.stability ?? null,
      fsrsDifficulty: row?.fsrsDifficulty ?? null,
      dueAt: row?.dueAt ?? null,
      reps: row?.reps ?? 0,
      lapses: row?.lapses ?? 0,
      lastReviewAt: row?.lastReviewAt ?? null,
    };

    const result = schedule(state, item.rating, now);

    if (state.reps === 0) newLearnedDelta += 1;
    reviewedDelta += 1;
    if (item.rating === 'remembered') correctDelta += 1;

    results.push({
      wordId: item.wordId,
      stage: result.next.stage,
      stability: result.next.stability,
      fsrsDifficulty: result.next.fsrsDifficulty,
      dueAt: result.next.dueAt,
      reps: result.next.reps,
      graduated: result.graduated,
      intervalMinutes: result.intervalMinutes,
    });

    stmts.push(
      db
        .insert(userWordStates)
        .values({
          userId,
          wordId: item.wordId,
          stage: result.next.stage,
          stability: result.next.stability,
          fsrsDifficulty: result.next.fsrsDifficulty,
          dueAt: result.next.dueAt,
          reps: result.next.reps,
          lapses: result.next.lapses,
          lastReviewAt: result.next.lastReviewAt,
          updatedAt: nowStr,
        })
        .onConflictDoUpdate({
          target: [userWordStates.userId, userWordStates.wordId],
          set: {
            stage: result.next.stage,
            stability: result.next.stability,
            fsrsDifficulty: result.next.fsrsDifficulty,
            dueAt: result.next.dueAt,
            reps: result.next.reps,
            lapses: result.next.lapses,
            lastReviewAt: result.next.lastReviewAt,
            updatedAt: nowStr,
          },
        }),
    );

    stmts.push(
      db.insert(reviewLogs).values({
        id: randomId(),
        userId,
        wordId: item.wordId,
        rating: item.rating,
        latencyMs: item.latencyMs == null ? null : Math.min(item.latencyMs, 3_600_000),
        reviewedAt: nowStr,
      }),
    );
  }

  // batch 要求非空元组；items 已校验 min(1)，每个 item 产生 2 条语句
  await db.batch(stmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  // daily_stats 原子累加（upsert + SQL 自增，避免读改写竞态）
  await db
    .insert(dailyStats)
    .values({
      userId,
      date,
      newLearned: newLearnedDelta,
      reviewed: reviewedDelta,
      correctCount: correctDelta,
      totalCount: reviewedDelta,
    })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: {
        newLearned: sql`${dailyStats.newLearned} + ${newLearnedDelta}`,
        reviewed: sql`${dailyStats.reviewed} + ${reviewedDelta}`,
        correctCount: sql`${dailyStats.correctCount} + ${correctDelta}`,
        totalCount: sql`${dailyStats.totalCount} + ${reviewedDelta}`,
      },
    });

  // streak 与成就解锁
  const statRows = await db
    .select({ date: dailyStats.date })
    .from(dailyStats)
    .where(eq(dailyStats.userId, userId));
  const streak = computeStreak(statRows.map((r) => r.date));

  const unlockedBadges: string[] = [];
  if (reviewedDelta > 0) unlockedBadges.push('first_review');
  if (streak >= 3) unlockedBadges.push('streak_3');
  if (streak >= 7) unlockedBadges.push('streak_7');

  if (unlockedBadges.length > 0) {
    await db
      .insert(achievements)
      .values(unlockedBadges.map((badgeKey) => ({ userId, badgeKey, unlockedAt: nowStr })))
      .onConflictDoNothing();
  }

  return c.json({ results, streak, unlockedBadges });
});
