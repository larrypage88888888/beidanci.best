import { and, eq, gte } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
  RANK_TIER_EMOJI,
  RANK_TIERS,
  computeRankScore,
  estimateVocabSize,
  rankInfo,
  seasonKey,
  shiftDateKey,
} from '@app/core';
import { dailyStats, userRankMeta, userSeasonRank, users } from '@app/db';
import { dateKeyCn, nowIso } from './time';

/**
 * C10 段位计算（设计文档 §10.3）：
 * 评分 = 词汇量估算 + 近 7 天正确率 + 近 7 天活跃天数 → 青铜~词霸。
 * persist=true 时把当前赛季结算写入 user_season_rank 并维护历史最高段位。
 */
export async function computeUserRank(
  db: DrizzleD1Database,
  userId: string,
  opts: { persist: boolean },
): Promise<RankPayload> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error('user_not_found');

  const today = dateKeyCn();
  const since = shiftDateKey(today, -6);
  const weekRows = await db
    .select({ totalCount: dailyStats.totalCount, correctCount: dailyStats.correctCount })
    .from(dailyStats)
    .where(and(eq(dailyStats.userId, userId), gte(dailyStats.date, since)));
  const total = weekRows.reduce((a, r) => a + r.totalCount, 0);
  const correct = weekRows.reduce((a, r) => a + r.correctCount, 0);
  const activeDays7d = weekRows.filter((r) => r.totalCount > 0).length;
  const correctRate7d = total > 0 ? correct / total : null;

  const vocabEstimate = estimateVocabSize(user.level);
  const score = computeRankScore({ vocabEstimate, correctRate7d, activeDays7d });
  const info = rankInfo(score);
  const season = seasonKey();

  let bestTier = 0;
  let bestSeason: string | null = null;
  if (opts.persist) {
    await db
      .insert(userSeasonRank)
      .values({ userId, season, tier: info.tier, score })
      .onConflictDoUpdate({
        target: [userSeasonRank.userId, userSeasonRank.season],
        set: { tier: info.tier, score },
      });

    const [meta] = await db.select().from(userRankMeta).where(eq(userRankMeta.userId, userId)).limit(1);
    bestTier = meta?.bestTier ?? 0;
    bestSeason = meta?.bestSeason ?? null;
    if (info.tier > bestTier) {
      bestTier = info.tier;
      bestSeason = season;
      await db
        .insert(userRankMeta)
        .values({ userId, bestTier, bestSeason, updatedAt: nowIso() })
        .onConflictDoUpdate({
          target: userRankMeta.userId,
          set: { bestTier, bestSeason, updatedAt: nowIso() },
        });
    }
  } else {
    const [meta] = await db.select().from(userRankMeta).where(eq(userRankMeta.userId, userId)).limit(1);
    bestTier = Math.max(meta?.bestTier ?? 0, info.tier);
    bestSeason = meta?.bestSeason ?? (info.tier > 0 ? season : null);
  }

  return {
    season,
    tier: info.tier,
    tierLabel: info.label,
    tierEmoji: info.emoji,
    score: info.score,
    bestTier,
    bestTierLabel: RANK_TIERS[bestTier],
    bestTierEmoji: RANK_TIER_EMOJI[bestTier],
    next: info.next,
    breakdown: { vocabEstimate, correctRate7d, activeDays7d },
  };
}

export interface RankPayload {
  season: string;
  tier: number;
  tierLabel: string;
  tierEmoji: string;
  score: number;
  bestTier: number;
  bestTierLabel: string;
  bestTierEmoji: string;
  next: { tier: number; label: string; emoji: string; neededScore: number } | null;
  breakdown: { vocabEstimate: number; correctRate7d: number | null; activeDays7d: number };
}
