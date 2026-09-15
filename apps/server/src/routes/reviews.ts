import { Hono } from 'hono';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { achievements, dailyStats, reviewLogs, userInventory, userPets, userWordStates, users } from '@app/db';
import { PET_STAGES, cardDrawAllowance, computeStreak, isRating, schedule, updatePet } from '@app/core';
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
  /** 本次回写所在会话的当日最高连击（服务端做 MAX 合并，抽卡加成/周报用） */
  maxCombo: z.number().int().min(0).max(99999).optional(),
});

reviewsRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  const parsed = BatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const { items, maxCombo } = parsed.data;
  const db = getDb(c.env);
  const maxComboIn = maxCombo ?? 0;

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

  // 同一批次内去重：同一词只处理首次（避免新词计数重复累加、重复日志、重复调度）
  const seenInBatch = new Set<string>();

  for (const item of items) {
    if (seenInBatch.has(item.wordId)) continue;
    seenInBatch.add(item.wordId);

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

  // daily_stats 原子累加（upsert + SQL 自增，避免读改写竞态）；max_combo 取历史最大值
  await db
    .insert(dailyStats)
    .values({
      userId,
      date,
      newLearned: newLearnedDelta,
      reviewed: reviewedDelta,
      correctCount: correctDelta,
      totalCount: reviewedDelta,
      maxCombo: maxComboIn,
    })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: {
        newLearned: sql`${dailyStats.newLearned} + ${newLearnedDelta}`,
        reviewed: sql`${dailyStats.reviewed} + ${reviewedDelta}`,
        correctCount: sql`${dailyStats.correctCount} + ${correctDelta}`,
        totalCount: sql`${dailyStats.totalCount} + ${reviewedDelta}`,
        maxCombo: sql`MAX(${dailyStats.maxCombo}, ${maxComboIn})`,
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

  // ── P0 趣味化：词苗养成 + 词卡抽卡资格（设计文档 §十）──
  const [todayStats] = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)))
    .limit(1);

  const [petRow] = await db.select().from(userPets).where(eq(userPets.userId, userId)).limit(1);
  const [invRow] = await db
    .select({ count: userInventory.count })
    .from(userInventory)
    .where(and(eq(userInventory.userId, userId), eq(userInventory.itemType, 'revive_card')))
    .limit(1);
  const invCount = invRow?.count ?? 0;
  const petResult = updatePet(
    petRow
      ? {
          stageIdx: (petRow.stageIdx ?? 0) as 0 | 1 | 2 | 3,
          treeAgeDays: petRow.treeAgeDays,
          lastWaterAt: petRow.lastWaterAt,
          wiltSince: petRow.wiltSince,
          reviveDeadline: petRow.reviveDeadline,
          wilted: petRow.wilted,
        }
      : null,
    { today: date, todayReviewed: todayStats?.reviewed ?? 0, hasReviveCard: invCount > 0 },
  );

  const petStmts: BatchItem<'sqlite'>[] = [];
  if (petResult.grantReviveCard) {
    petStmts.push(
      db
        .insert(userInventory)
        .values({ userId, itemType: 'revive_card', count: 1 })
        .onConflictDoNothing(),
    );
  }
  if (petResult.consumedReviveCard) {
    petStmts.push(
      db
        .update(userInventory)
        .set({ count: sql`${userInventory.count} - 1` })
        .where(and(eq(userInventory.userId, userId), eq(userInventory.itemType, 'revive_card'))),
    );
  }
  petStmts.push(
    db
      .insert(userPets)
      .values({
        userId,
        stageIdx: petResult.pet.stageIdx,
        treeAgeDays: petResult.pet.treeAgeDays,
        lastWaterAt: petResult.pet.lastWaterAt,
        wiltSince: petResult.pet.wiltSince,
        reviveDeadline: petResult.pet.reviveDeadline,
        wilted: petResult.pet.wilted,
        createdAt: nowStr,
      })
      .onConflictDoUpdate({
        target: userPets.userId,
        set: {
          stageIdx: petResult.pet.stageIdx,
          treeAgeDays: petResult.pet.treeAgeDays,
          lastWaterAt: petResult.pet.lastWaterAt,
          wiltSince: petResult.pet.wiltSince,
          reviveDeadline: petResult.pet.reviveDeadline,
          wilted: petResult.pet.wilted,
        },
      }),
  );
  await db.batch(petStmts as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  const draw = cardDrawAllowance({
    answeredToday: todayStats?.totalCount ?? 0,
    comboBest: todayStats?.maxCombo ?? 0,
    drawn: todayStats?.cardsDrawn ?? 0,
    battleWinsToday: todayStats?.battleWins ?? 0,
  });

  return c.json({
    results,
    streak,
    unlockedBadges,
    pet: {
      stageIdx: petResult.pet.stageIdx,
      stageLabel: PET_STAGES[petResult.pet.stageIdx].label,
      emoji: PET_STAGES[petResult.pet.stageIdx].emoji,
      treeAgeDays: petResult.pet.treeAgeDays,
      wilted: petResult.pet.wilted,
      reviveDeadline: petResult.pet.reviveDeadline,
      needsWords: petResult.needsWords,
      revived: petResult.revived,
      hardReset: petResult.hardReset,
    },
    cardDraw: draw,
    todayMaxCombo: todayStats?.maxCombo ?? 0,
    reviveCards: Math.max(0, invCount + (petResult.grantReviveCard ? 1 : 0) - (petResult.consumedReviveCard ? 1 : 0)),
  });
});
