import { and, eq, gte, isNull, like, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { dailyPlans, users, userWordStates, words } from '@app/db';
import { buildDailyQueue, hashSeed, levelBand } from '@app/core';
import { nowIso } from './time';

/**
 * 每日组单（设计文档 §四.4）—— 服务端权威执行：
 *   新词池（难度 ≈ 水平 ± 半档）＋ 到期复习词，穿插成今日队列。
 * GET /today 首次访问现算兜底；Cron 每日预物化。同一用户同一天只建一次。
 */
export interface TodayPlan {
  date: string;
  newWordIds: string[];
  reviewWordIds: string[];
  order: string[];
  /** 本次调用是否为现算新建（cron 统计用） */
  created: boolean;
}

export async function getOrBuildTodayPlan(
  db: DrizzleD1Database,
  userId: string,
  dateKey: string,
): Promise<TodayPlan | null> {
  // 1) 已物化直接返回
  const [existing] = await db
    .select()
    .from(dailyPlans)
    .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, dateKey)))
    .limit(1);
  if (existing) {
    return {
      date: existing.date,
      newWordIds: JSON.parse(existing.newWordIdsJson) as string[],
      reviewWordIds: JSON.parse(existing.reviewWordIdsJson) as string[],
      order: JSON.parse(existing.orderJson) as string[],
      created: false,
    };
  }

  // 2) 用户参数
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const nowIsoStr = nowIso();

  // 3) 到期复习词：due_at <= now 且未毕业（兼容 stage 为 NULL 的 FSRS 状态）
  const dueRows = await db
    .select({ wordId: userWordStates.wordId })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        lte(userWordStates.dueAt, nowIsoStr),
        or(isNull(userWordStates.stage), ne(userWordStates.stage, 9)),
      ),
    )
    .limit(300);

  // 4) 新词候选池：目标词书 + 难度贴近水平 ± 半档 + 从未学过
  const bookTag = user.goalBookId ?? 'cet4';
  const learnedSub = db
    .select({ wid: userWordStates.wordId })
    .from(userWordStates)
    .where(eq(userWordStates.userId, userId));
  const band = levelBand(user.level, 12);

  let candidateRows = await db
    .select({ id: words.id })
    .from(words)
    .where(
      and(
        like(words.tagsJson, `%"${bookTag}"%`),
        gte(words.difficulty, band.min),
        lte(words.difficulty, band.max),
        notInArray(words.id, learnedSub),
      ),
    )
    .orderBy(sql`abs(${words.difficulty} - ${user.level})`)
    .limit(Math.max(user.dailyNewLimit * 3, 20));

  // 候选不足时放宽难度窗口
  if (candidateRows.length < user.dailyNewLimit) {
    candidateRows = await db
      .select({ id: words.id })
      .from(words)
      .where(and(like(words.tagsJson, `%"${bookTag}"%`), notInArray(words.id, learnedSub)))
      .orderBy(sql`abs(${words.difficulty} - ${user.level})`)
      .limit(Math.max(user.dailyNewLimit * 3, 20));
  }

  // 5) 组单（种子确定性：同用户同日重复拉取一致）
  const queue = buildDailyQueue({
    candidateNewWordIds: candidateRows.map((r) => r.id),
    dueReviewWordIds: dueRows.map((r) => r.wordId),
    newLimit: user.dailyNewLimit,
    seed: hashSeed(`${userId}:${dateKey}`),
  });

  await db
    .insert(dailyPlans)
    .values({
      userId,
      date: dateKey,
      newWordIdsJson: JSON.stringify(queue.newWordIds),
      reviewWordIdsJson: JSON.stringify(queue.reviewWordIds),
      orderJson: JSON.stringify(queue.order),
      materializedAt: nowIso(),
    })
    .onConflictDoNothing();

  return { date: dateKey, ...queue, created: true };
}
