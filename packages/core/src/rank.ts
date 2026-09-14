/**
 * C10 段位系统（设计文档 §10.3）：评分 = 词汇量估算 + 近7天正确率 + 近7天活跃天数。
 * 每月 1 号结算（season = YYYY-MM）；保留历史最高段位；段位解锁更高难度 CEFR 词包。
 * 纯函数规则，web/server 共用，可单测。
 */

export type RankTier = 0 | 1 | 2 | 3 | 4 | 5;

export const RANK_TIERS = ['青铜', '白银', '黄金', '铂金', '钻石', '词霸'] as const;
export const RANK_TIER_EMOJI = ['🥉', '🥈', '🥇', '💠', '💎', '👑'] as const;

export const RANK_TIER_THRESHOLDS: ReadonlyArray<{ tier: RankTier; minScore: number }> = [
  { tier: 0, minScore: 0 },
  { tier: 1, minScore: 24 },
  { tier: 2, minScore: 42 },
  { tier: 3, minScore: 58 },
  { tier: 4, minScore: 73 },
  { tier: 5, minScore: 88 },
] as const;

export interface RankInput {
  /** 词汇量估算（由 @app/core estimateVocabSize 得到） */
  vocabEstimate: number;
  /** 近 7 天正确率 0..1；无作答数据时为 null */
  correctRate7d: number | null;
  /** 近 7 天有学习活动的天数 0..7 */
  activeDays7d: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 段位评分 0..100：
 * - 词汇量 0..45：log 缩放（500→0，16000→45）
 * - 正确率 0..25（仅当近 7 天有活跃时计入，避免躺平刷分）
 * - 活跃天数 0..30（7 天全勤封顶）
 */
export function computeRankScore(input: RankInput): number {
  const v = Math.max(input.vocabEstimate, 100);
  const logLo = Math.log10(500);
  const logHi = Math.log10(16000);
  const vocabScore = clamp((45 * (Math.log10(v) - logLo)) / (logHi - logLo), 0, 45);

  const rateScore = input.activeDays7d > 0 ? clamp(input.correctRate7d ?? 0.75, 0, 1) * 25 : 0;
  const dayScore = (clamp(input.activeDays7d, 0, 7) / 7) * 30;

  return Math.round((vocabScore + rateScore + dayScore) * 10) / 10;
}

export function tierForScore(score: number): RankTier {
  let tier: RankTier = 0;
  for (const t of RANK_TIER_THRESHOLDS) {
    if (score >= t.minScore) tier = t.tier;
  }
  return tier;
}

export interface RankInfo {
  tier: RankTier;
  label: string;
  emoji: string;
  score: number;
  /** 距下一段的缺口；已到最高段则为 null */
  next: { tier: RankTier; label: string; emoji: string; neededScore: number } | null;
}

export function rankInfo(score: number): RankInfo {
  const tier = tierForScore(score);
  const next = tier < 5 ? RANK_TIER_THRESHOLDS[tier + 1] : null;
  return {
    tier,
    label: RANK_TIERS[tier],
    emoji: RANK_TIER_EMOJI[tier],
    score,
    next: next
      ? {
          tier: next.tier,
          label: RANK_TIERS[next.tier],
          emoji: RANK_TIER_EMOJI[next.tier],
          neededScore: next.minScore - score,
        }
      : null,
  };
}

/** 赛季键：YYYY-MM（UTC），按当前日期 */
export function seasonKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** 是否为「本月 1 号」：月度结算触发判断 */
export function isSeasonSettleDay(d: Date = new Date()): boolean {
  return d.getUTCDate() === 1;
}
