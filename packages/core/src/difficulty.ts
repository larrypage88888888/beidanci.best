import type { CefrLevel, WordMeta } from './types';

/**
 * 统一难度轴（设计文档 §4.1）
 *
 * 所有词书的单词映射到同一把尺子：difficulty ∈ [0, 100]，
 * 参考维度 = CEFR 等级 + 词频排名 + 词长/构词复杂度。
 *
 * 权重：CEFR 60% / 词频 25% / 构词 15%；缺失维度按比例摊给其余维度。
 */

const CEFR_BASE: Record<CefrLevel, number> = {
  A1: 8,
  A2: 22,
  B1: 40,
  B2: 58,
  C1: 76,
  C2: 90,
};

/** 词频排名 → 0..100 分（越靠前越简单）。排名未知返回 null */
export function frequencyScore(frequencyRank?: number): number | null {
  if (frequencyRank == null || frequencyRank <= 0) return null;
  // 对数刻度：rank 1 → ~2 分，rank 100 → ~40，rank 10k → ~67，rank 100k+ → 封顶 95
  const score = 100 - (Math.log10(frequencyRank) / 5) * 98;
  return Math.min(98, Math.max(2, score));
}

/** 常见派生后缀，构词复杂度轻微加分 */
const COMPLEX_SUFFIXES = [
  'ness', 'tion', 'sion', 'ment', 'able', 'ible', 'ance', 'ence', 'ology',
  'ous', 'ive', 'ful', 'less', 'ise', 'ize', 'ify',
] as const;

/** 词长/构词复杂度 → 0..100 分 */
export function complexityScore(text: string): number {
  const word = text.toLowerCase().trim();
  const len = word.length;
  // 长度分：<=3 → 5，4-5 → 15，6-7 → 30，8-9 → 50，>=12 → 85
  let score =
    len <= 3 ? 5 : len <= 5 ? 15 : len <= 7 ? 32 : len <= 9 ? 52 : len <= 11 ? 70 : 85;
  if (COMPLEX_SUFFIXES.some((s) => word.endsWith(s))) score += 10;
  if (/^[a-z]+$/i.test(word) === false) score += 5; // 含连字符等
  return Math.min(100, score);
}

/**
 * 计算一个词的统一难度分。
 * 纯函数、确定性：同样的输入永远得到同样的分数（服务端懒计算写回依赖这一点）。
 */
export function computeDifficulty(word: Pick<WordMeta, 'text' | 'cefr' | 'frequencyRank'>): number {
  const parts: Array<{ score: number; weight: number }> = [];

  if (word.cefr && word.cefr in CEFR_BASE) {
    parts.push({ score: CEFR_BASE[word.cefr], weight: 60 });
  }
  const freq = frequencyScore(word.frequencyRank);
  if (freq != null) {
    parts.push({ score: freq, weight: 25 });
  }
  parts.push({ score: complexityScore(word.text), weight: 15 });

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.score * p.weight, 0) / totalWeight;
  return Math.round(Math.min(100, Math.max(0, weighted)) * 10) / 10;
}

/** 难度分 → 最接近的 CEFR 档位（展示用） */
export function difficultyToCefr(difficulty: number): CefrLevel {
  const entries = Object.entries(CEFR_BASE) as Array<[CefrLevel, number]>;
  let best: CefrLevel = 'A1';
  let bestDelta = Infinity;
  for (const [level, base] of entries) {
    const delta = Math.abs(base - difficulty);
    if (delta < bestDelta) {
      best = level;
      bestDelta = delta;
    }
  }
  return best;
}

/** 用户水平(难度轴位置) ± 半档 的候选区间，用于组单新词池粗筛 */
export function levelBand(level: number, halfBand = 12): { min: number; max: number } {
  return { min: Math.max(0, level - halfBand), max: Math.min(100, level + halfBand) };
}
