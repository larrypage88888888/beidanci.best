import { Hono } from 'hono';
import { and, eq, lte, ne, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { achievements, dailyPlans, dailyStats, reviewLogs, userBattles, userBossDaily, userCards, userInventory, userPets, userPoints, userRankMeta, userSeasonRank, userWordStates, users, wordbooks } from '@app/db';
import { PET_STAGES, cardDrawAllowance, computeStreak, migrateCardState } from '@app/core';
import type { CardState } from '@app/core';
import { publicUser } from './auth';
import { dateKeyCn, nowIso } from '../lib/time';
import { getDb } from '../lib/db';
import { computeUserRank } from '../lib/rankService';
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
  /** C10：切换目标词书（需段位解锁） */
  goalBookId: z.string().min(1).max(40).optional(),
});

meRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'not_found', message: '用户不存在' }, 404);

  // streak：取有学习记录的日期集合（传北京日期键，与 daily_stats 口径一致）
  const statRows = await db.select({ date: dailyStats.date }).from(dailyStats).where(eq(dailyStats.userId, userId));
  const streak = computeStreak(statRows.map((r) => r.date), dateKeyCn());

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

  // P0 趣味化（§十）：词苗 / 词力积分 / 图鉴数 / 复活卡 / 抽卡资格
  const [pet, pointsRow, cardsRow, invRow] = await Promise.all([
    petInfo(db, userId),
    db.select().from(userPoints).where(eq(userPoints.userId, userId)).limit(1),
    db.select({ n: sql<number>`count(*)` }).from(userCards).where(eq(userCards.userId, userId)),
    db
      .select({ count: userInventory.count })
      .from(userInventory)
      .where(and(eq(userInventory.userId, userId), eq(userInventory.itemType, 'revive_card')))
      .limit(1),
  ]);
  const [today] = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, dateKeyCn())))
    .limit(1);
  const cardDraw = cardDrawAllowance({
    answeredToday: today?.totalCount ?? 0,
    comboBest: today?.maxCombo ?? 0,
    drawn: today?.cardsDrawn ?? 0,
    battleWinsToday: today?.battleWins ?? 0,
  });

  // C10 段位概览（只读计算，不落库——结算在 /api/rank/current 与月度 Cron）
  let rank: RankSummary | null = null;
  try {
    const r = await computeUserRank(db, userId, { persist: false });
    rank = { tier: r.tier, tierLabel: r.tierLabel, tierEmoji: r.tierEmoji, score: r.score, bestTier: r.bestTier, bestTierLabel: r.bestTierLabel, bestTierEmoji: r.bestTierEmoji };
  } catch {
    rank = null; // 理论不失败；兜底不影响主流程
  }

  return c.json({
    user: publicUser(user),
    streak,
    dueCount: Number(dueRow[0]?.n ?? 0) + Number(dueNullRow[0]?.n ?? 0),
    pet,
    points: pointsRow[0]?.balance ?? 0,
    cardsCount: Number(cardsRow[0]?.n ?? 0),
    reviveCards: invRow[0]?.count ?? 0,
    cardDraw,
    rank,
  });
});

interface RankSummary {
  tier: number;
  tierLabel: string;
  tierEmoji: string;
  score: number;
  bestTier: number;
  bestTierLabel: string;
  bestTierEmoji: string;
}

/** 词苗展示信息（无则 null） */
async function petInfo(db: ReturnType<typeof getDb>, userId: string) {
  const [pet] = await db.select().from(userPets).where(eq(userPets.userId, userId)).limit(1);
  if (!pet) return null;
  const idx = (pet.stageIdx ?? 0) as 0 | 1 | 2 | 3;
  return {
    stageIdx: idx,
    stageLabel: PET_STAGES[idx].label,
    emoji: PET_STAGES[idx].emoji,
    treeAgeDays: pet.treeAgeDays,
    wilted: pet.wilted,
    reviveDeadline: pet.reviveDeadline,
  };
}

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

  // 切换词书：校验存在性 + 段位解锁门槛（历史最高段位 ≥ min_tier）
  if (parsed.data.goalBookId) {
    const [book] = await db
      .select({ minTier: wordbooks.minTier })
      .from(wordbooks)
      .where(eq(wordbooks.id, parsed.data.goalBookId))
      .limit(1);
    if (!book) return c.json({ error: 'not_found', message: '词书不存在' }, 404);
    const [meta] = await db.select().from(userRankMeta).where(eq(userRankMeta.userId, userId)).limit(1);
    if ((meta?.bestTier ?? 0) < book.minTier) {
      return c.json({ error: 'locked', message: '段位不足，暂未解锁该词书' }, 403);
    }
  }

  // 模式真正变化时才做状态迁移
  if (parsed.data.scheduleMode && parsed.data.scheduleMode !== user.scheduleMode) {
    await migrateStates(db, userId, user.scheduleMode, parsed.data.scheduleMode);
  }

  // 每日新词上限变化 → 作废今日已物化计划（下次访问 /today 按新上限重建，立即生效）
  if (parsed.data.dailyNewLimit !== undefined && parsed.data.dailyNewLimit !== user.dailyNewLimit) {
    await db
      .delete(dailyPlans)
      .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, dateKeyCn())));
  }

  const [updated] = await db
    .update(users)
    .set({
      ...(parsed.data.nickname !== undefined ? { nickname: parsed.data.nickname } : {}),
      ...(parsed.data.dailyNewLimit !== undefined ? { dailyNewLimit: parsed.data.dailyNewLimit } : {}),
      ...(parsed.data.scheduleMode !== undefined ? { scheduleMode: parsed.data.scheduleMode } : {}),
      ...(parsed.data.goalBookId !== undefined ? { goalBookId: parsed.data.goalBookId } : {}),
    })
    .where(eq(users.id, userId))
    .returning();

  return c.json({ user: publicUser(updated) });
});

/* POST /api/me/reset —— 一键清空所有学习记录，重新开始背单词。
 * 删除：学习状态/复习日志/每日计划/每日统计/成就/词苗/词卡图鉴/词力积分/道具/段位/对战记录；
 * 重置：摸底状态（需重做摸底）与水平；保留：账号、密码、偏好设置（词书/每日新词数/调度模式）。 */
meRoutes.post('/reset', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return c.json({ error: 'not_found', message: '用户不存在' }, 404);

  await db.batch([
    db.delete(userWordStates).where(eq(userWordStates.userId, userId)),
    db.delete(reviewLogs).where(eq(reviewLogs.userId, userId)),
    db.delete(dailyPlans).where(eq(dailyPlans.userId, userId)),
    db.delete(dailyStats).where(eq(dailyStats.userId, userId)),
    db.delete(achievements).where(eq(achievements.userId, userId)),
    db.delete(userPets).where(eq(userPets.userId, userId)),
    db.delete(userCards).where(eq(userCards.userId, userId)),
    db.delete(userPoints).where(eq(userPoints.userId, userId)),
    db.delete(userInventory).where(eq(userInventory.userId, userId)),
    db.delete(userSeasonRank).where(eq(userSeasonRank.userId, userId)),
    db.delete(userRankMeta).where(eq(userRankMeta.userId, userId)),
    db.delete(userBattles).where(eq(userBattles.userId, userId)),
    db.delete(userBossDaily).where(eq(userBossDaily.userId, userId)),
  ] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

  const [updated] = await db
    .update(users)
    .set({ level: 50, placementDone: false })
    .where(eq(users.id, userId))
    .returning();

  return c.json({ ok: true, user: publicUser(updated) });
});
