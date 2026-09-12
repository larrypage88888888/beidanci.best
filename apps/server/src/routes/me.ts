import { Hono } from 'hono';
import { and, eq, lte, ne, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { dailyStats, userWordStates, users } from '@app/db';
import { computeStreak, migrateCardState } from '@app/core';
import type { CardState } from '@app/core';
import { publicUser } from './auth';
import { nowIso } from '../lib/time';
import { getDb } from '../lib/db';
import { requireAuth } from '../middleware/auth';

/**
 * GET   /api/me —— 用户水平、调度模式、目标词书、streak 与待复习数。
 * PATCH /api/me —— 更新昵称/每日新词数/调度模式（模式切换时迁移历史进度）。
 */
export const meRoutes = new Hono<AppEnv>();
meRoutes.use('*', requireAuth);

const PatchSchema = z.object({
  nickname: z.string().min(1).max(30).optional(),
  dailyNewLimit: z.number().int().min(1).max(100).optional(),
  scheduleMode: z.enum(['ebbinghaus', 'fsrs']).optional(),
});

meRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'not_found', message: '用户不存在' }, 404);

  // streak：取有学习记录的日期集合
  const statRows = await db.select({ date: dailyStats.date }).from(dailyStats).where(eq(dailyStats.userId, userId));
  const streak = computeStreak(statRows.map((r) => r.date));

  // 当前到期未毕业的词数（含未学新词之外的存量）
  const dueRow = await db.select({ n: sql<number>`count(*)` })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        lte(userWordStates.dueAt, nowIso()),
        ne(userWordStates.stage, 9),
      ),
    );
  // FSRS 模式下 stage 可能为 NULL，单独统计一次兜底
  const dueNullRow = await db.select({ n: sql<number>`count(*)` })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        lte(userWordStates.dueAt, nowIso()),
        isNull(userWordStates.stage),
      ),
    );

  return c.json({
    user: publicUser(user),
    streak,
    dueCount: Number(dueRow[0]?.n ?? 0) + Number(dueNullRow[0]?.n ?? 0),
  });
});

/** 模式切换：用共享核心的 migrateCardState 批量迁移既有状态（近似映射，不丢进度） */
async function migrateStates(
  db: ReturnType<typeof getDb>,
  userId: string,
  fromMode: string,
  toMode: 'ebbinghaus' | 'fsrs',
): Promise<void> {
  const rows = await db.select().from(userWordStates).where(eq(userWordStates.userId, userId)).limit(500);
  const updates = rows
    .map((r) => {
      const card: CardState = {
        wordId: r.wordId,
        mode: fromMode === 'fsrs' ? 'fsrs' : 'ebbinghaus',
        stage: r.stage,
        stability: r.stability,
        fsrsDifficulty: r.fsrsDifficulty,
        dueAt: r.dueAt,
        reps: r.reps,
        lapses: r.lapses,
        lastReviewAt: r.lastReviewAt,
      };
      return migrateCardState(card, toMode);
    })
    .map((migrated) =>
      db
        .update(userWordStates)
        .set({
          stage: migrated.stage,
          stability: migrated.stability,
          fsrsDifficulty: migrated.fsrsDifficulty,
          updatedAt: nowIso(),
        })
        .where(and(eq(userWordStates.userId, userId), eq(userWordStates.wordId, migrated.wordId))),
    );

  if (updates.length > 0) {
    await db.batch(updates as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  }
}

meRoutes.patch('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const parsed = PatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'not_found', message: '用户不存在' }, 404);

  // 模式真正变化时才做状态迁移
  if (parsed.data.scheduleMode && parsed.data.scheduleMode !== user.scheduleMode) {
    await migrateStates(db, userId, user.scheduleMode, parsed.data.scheduleMode);
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(parsed.data.nickname !== undefined ? { nickname: parsed.data.nickname } : {}),
      ...(parsed.data.dailyNewLimit !== undefined ? { dailyNewLimit: parsed.data.dailyNewLimit } : {}),
      ...(parsed.data.scheduleMode !== undefined ? { scheduleMode: parsed.data.scheduleMode } : {}),
    })
    .where(eq(users.id, userId))
    .returning();

  return c.json({ user: publicUser(updated) });
});
