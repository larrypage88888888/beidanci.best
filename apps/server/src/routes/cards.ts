import { Hono } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { dailyPlans, dailyStats, userCards, userPoints, userWordStates } from '@app/db';
import { DUPLICATE_POINTS, cardDrawAllowance, rollCardRarity } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { dateKeyUtc, dayStartIso, nowIso } from '../lib/time';
import { getDb } from '../lib/db';
import { loadWordsByIds } from '../lib/wordQueries';

/**
 * 词卡抽卡（设计文档 §10.2 A2）：
 * - 每天累计作答 ≥15 词 → 基础 1 次；当日最高连击 ≥10 → 额外 +1
 * - 抽卡范围：当天学过的词（优先），兜底当日新词计划
 * - 抽到已收藏词 → 自动转词力积分（决策 #2）
 */
export const cardsRoutes = new Hono<AppEnv>();
cardsRoutes.use('*', requireAuth);

function parseDefs(json: string | null): Array<{ pos?: string; meaning: string }> {
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
}

function parseIds(json: string | null): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 今日抽卡资格（供 collection / draw 共用） */
async function todayAllowance(db: ReturnType<typeof getDb>, userId: string, date: string) {
  const [today] = await db
    .select()
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date)))
    .limit(1);
  return {
    draw: cardDrawAllowance({
      answeredToday: today?.totalCount ?? 0,
      comboBest: today?.maxCombo ?? 0,
      drawn: today?.cardsDrawn ?? 0,
      battleWinsToday: today?.battleWins ?? 0,
    }),
    today,
  };
}

// GET /api/cards/collection —— 词卡图鉴
cardsRoutes.get('/collection', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const rows = await db
    .select()
    .from(userCards)
    .where(eq(userCards.userId, userId))
    .orderBy(desc(userCards.obtainedAt))
    .limit(500);

  const wordRows = rows.length > 0 ? await loadWordsByIds(db, rows.map((r) => r.wordId)) : [];
  const wordMap = new Map(wordRows.map((w) => [w.id, w]));

  const counts = { SR: 0, SSR: 0, UR: 0 };
  for (const r of rows) {
    const k = r.rarity === 'UR' ? 'UR' : r.rarity === 'SSR' ? 'SSR' : 'SR';
    counts[k] += 1;
  }

  const items = rows.map((r) => {
    const w = wordMap.get(r.wordId);
    return {
      wordId: r.wordId,
      text: w?.text ?? r.wordId,
      phonetic: w?.phonetic ?? undefined,
      definitions: parseDefs(w?.definitionsJson ?? null),
      rarity: r.rarity,
      obtainedAt: r.obtainedAt,
    };
  });

  const [pointsRow] = await db.select().from(userPoints).where(eq(userPoints.userId, userId)).limit(1);
  const { draw } = await todayAllowance(db, userId, dateKeyUtc());

  return c.json({
    items,
    counts: { ...counts, total: rows.length },
    points: pointsRow?.balance ?? 0,
    draw,
  });
});

// POST /api/cards/draw —— 抽一张词卡
cardsRoutes.post('/draw', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  const date = dateKeyUtc();

  const { draw } = await todayAllowance(db, userId, date);
  if (draw.remaining <= 0) {
    return c.json({ error: 'no_draws', message: '今天没有可抽卡次数了，明天再来吧' }, 409);
  }

  // 候选词：今天学过的词（lastReviewAt 在今天内），兜底当日新词计划
  let candidateIds: string[] = [];
  const learned = await db
    .select({ wordId: userWordStates.wordId })
    .from(userWordStates)
    .where(and(eq(userWordStates.userId, userId), gte(userWordStates.lastReviewAt, dayStartIso(date))))
    .limit(100);
  candidateIds = learned.map((r) => r.wordId);
  if (candidateIds.length === 0) {
    const [plan] = await db
      .select({ ids: dailyPlans.newWordIdsJson })
      .from(dailyPlans)
      .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, date)))
      .limit(1);
    candidateIds = plan ? parseIds(plan.ids) : [];
  }
  if (candidateIds.length === 0) {
    return c.json({ error: 'no_words', message: '今天还没学过词，先去学几个再来抽卡吧' }, 409);
  }

  const wordId = candidateIds[Math.floor(Math.random() * candidateIds.length)];
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const rarity = rollCardRarity(seed);

  // 已收藏 → 转词力积分；否则入库收藏
  const [existing] = await db
    .select({ wordId: userCards.wordId })
    .from(userCards)
    .where(and(eq(userCards.userId, userId), eq(userCards.wordId, wordId)))
    .limit(1);

  let duplicate = false;
  let pointsGained = 0;
  if (existing) {
    duplicate = true;
    pointsGained = DUPLICATE_POINTS[rarity];
    await db
      .insert(userPoints)
      .values({ userId, balance: pointsGained })
      .onConflictDoUpdate({
        target: userPoints.userId,
        set: { balance: sql`${userPoints.balance} + ${pointsGained}` },
      });
  } else {
    await db.insert(userCards).values({ userId, wordId, rarity, obtainedAt: nowIso() });
  }

  // 扣减今日抽卡次数（无当日统计行时兜底插入，防止次数不扣）
  await db
    .insert(dailyStats)
    .values({ userId, date, cardsDrawn: 1 })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: { cardsDrawn: sql`${dailyStats.cardsDrawn} + 1` },
    });

  const [w] = await loadWordsByIds(db, [wordId]);
  return c.json({
    card: {
      wordId,
      text: w?.text ?? wordId,
      phonetic: w?.phonetic ?? undefined,
      definitions: parseDefs(w?.definitionsJson ?? null),
      rarity,
      duplicate,
      pointsGained,
    },
    remaining: draw.remaining - 1,
  });
});
