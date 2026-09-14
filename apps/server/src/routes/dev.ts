import { Hono } from 'hono';
import { and, asc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { userRankMeta, userWordStates } from '@app/db';
import { seasonKey } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { nowIso } from '../lib/time';
import { getDb } from '../lib/db';

/**
 * 本地开发测试工具（仅 DEV_MODE==='1' 时可用，生产环境不设置该变量）
 *
 * POST /api/dev/review-now {count?}
 * 把用户最早到期的 N 个已学词的 due_at 提前到现在，
 * 用于立即演示/验证艾宾浩斯快闪复习轮。
 *
 * POST /api/dev/rank-boost {tier?}
 * 把历史最高段位直接设为 tier（默认 3 黄金），用于演示/验证 C10 词书解锁门槛。
 */
export const devRoutes = new Hono<AppEnv>();
devRoutes.use('*', requireAuth);

const BodySchema = z.object({ count: z.number().int().min(1).max(20).optional() });

devRoutes.post('/review-now', async (c) => {
  if (c.env.DEV_MODE !== '1') {
    return c.json({ error: 'forbidden', message: '测试工具仅在本地开发模式（DEV_MODE=1）下开放' }, 403);
  }

  const userId = c.get('userId');
  const db = getDb(c.env);
  const parsed = BodySchema.safeParse(await c.req.json().catch(() => ({})));
  const count = parsed.success ? (parsed.data.count ?? 3) : 3;

  // 找最早到期的未毕业已学词
  const rows = await db
    .select({ wordId: userWordStates.wordId })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        isNotNull(userWordStates.dueAt),
        or(isNull(userWordStates.stage), ne(userWordStates.stage, 9)),
      ),
    )
    .orderBy(asc(userWordStates.dueAt))
    .limit(count);

  if (rows.length === 0) {
    return c.json({ error: 'empty', message: '还没有学习记录，先去学几个新词吧' }, 409);
  }

  const pastIso = new Date(Date.now() - 1000).toISOString();
  for (const r of rows) {
    await db
      .update(userWordStates)
      .set({ dueAt: pastIso })
      .where(and(eq(userWordStates.userId, userId), eq(userWordStates.wordId, r.wordId)));
  }

  return c.json({ wordIds: rows.map((r) => r.wordId), pulledAt: pastIso });
});

const RankBoostSchema = z.object({ tier: z.number().int().min(0).max(5).optional() });

devRoutes.post('/rank-boost', async (c) => {
  if (c.env.DEV_MODE !== '1') {
    return c.json({ error: 'forbidden', message: '测试工具仅在本地开发模式（DEV_MODE=1）下开放' }, 403);
  }

  const userId = c.get('userId');
  const parsed = RankBoostSchema.safeParse(await c.req.json().catch(() => ({})));
  const tier = parsed.success ? (parsed.data.tier ?? 3) : 3;
  const db = getDb(c.env);
  await db
    .insert(userRankMeta)
    .values({ userId, bestTier: tier, bestSeason: seasonKey(), updatedAt: nowIso() })
    .onConflictDoUpdate({
      target: userRankMeta.userId,
      set: { bestTier: tier, bestSeason: seasonKey(), updatedAt: nowIso() },
    });
  return c.json({ bestTier: tier });
});
