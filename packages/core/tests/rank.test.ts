import { describe, expect, it } from 'vitest';
import {
  RANK_TIER_EMOJI,
  RANK_TIERS,
  computeRankScore,
  isSeasonSettleDay,
  rankInfo,
  seasonKey,
  tierForScore,
} from '../src/rank';

describe('computeRankScore', () => {
  it('全新用户（无活跃）接近 0 分，只有词汇量底分', () => {
    const s = computeRankScore({ vocabEstimate: 3000, correctRate7d: null, activeDays7d: 0 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(24); // 青铜
  });

  it('词汇量越高底分越高（log 缩放）', () => {
    const low = computeRankScore({ vocabEstimate: 1000, correctRate7d: null, activeDays7d: 0 });
    const high = computeRankScore({ vocabEstimate: 12000, correctRate7d: null, activeDays7d: 0 });
    expect(high).toBeGreaterThan(low);
  });

  it('无活跃时正确率不计分（防躺平）', () => {
    const a = computeRankScore({ vocabEstimate: 5000, correctRate7d: 1, activeDays7d: 0 });
    const b = computeRankScore({ vocabEstimate: 5000, correctRate7d: 0.5, activeDays7d: 0 });
    expect(a).toBe(b);
  });

  it('活跃 7 天 + 高正确率大幅加分', () => {
    const s = computeRankScore({ vocabEstimate: 4000, correctRate7d: 0.85, activeDays7d: 7 });
    expect(s).toBeGreaterThan(70);
  });

  it('满分不超过 100', () => {
    const s = computeRankScore({ vocabEstimate: 16000, correctRate7d: 1, activeDays7d: 7 });
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe('tierForScore / rankInfo', () => {
  it('分档边界', () => {
    expect(tierForScore(0)).toBe(0);
    expect(tierForScore(23.9)).toBe(0);
    expect(tierForScore(24)).toBe(1);
    expect(tierForScore(41.9)).toBe(1);
    expect(tierForScore(42)).toBe(2);
    expect(tierForScore(57.9)).toBe(2);
    expect(tierForScore(58)).toBe(3);
    expect(tierForScore(72.9)).toBe(3);
    expect(tierForScore(73)).toBe(4);
    expect(tierForScore(87.9)).toBe(4);
    expect(tierForScore(88)).toBe(5);
    expect(tierForScore(100)).toBe(5);
  });

  it('rankInfo 给出下一段缺口；满段为 null', () => {
    const mid = rankInfo(50);
    expect(mid.label).toBe(RANK_TIERS[2]);
    expect(mid.next?.label).toBe(RANK_TIERS[3]);
    expect(mid.next?.neededScore).toBe(58 - 50);

    const top = rankInfo(95);
    expect(top.tier).toBe(5);
    expect(top.next).toBeNull();
    expect(top.emoji).toBe(RANK_TIER_EMOJI[5]);
  });
});

describe('season', () => {
  it('seasonKey 输出 YYYY-MM（UTC）', () => {
    expect(seasonKey(new Date('2026-09-14T12:00:00Z'))).toBe('2026-09');
    expect(seasonKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
    expect(seasonKey(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01');
  });

  it('isSeasonSettleDay 仅本月 1 号为 true', () => {
    expect(isSeasonSettleDay(new Date('2026-09-01T00:00:00Z'))).toBe(true);
    expect(isSeasonSettleDay(new Date('2026-09-14T00:00:00Z'))).toBe(false);
    expect(isSeasonSettleDay(new Date('2026-10-01T23:00:00Z'))).toBe(true);
  });
});
