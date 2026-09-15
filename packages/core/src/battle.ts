/**
 * 卡牌对战（炉石式 PVE 词灵对决）—— 用现有题型作答当「出招」：
 * 答对 → 召唤手牌词卡随从攻击（伤害 = 卡牌 ATK + 连击加成）；
 * 答错 → 被对手词灵随从反击（英雄扣血 = 随从威胁值）。
 * 英雄生命 / 法力水晶 / 手牌费用 / 随从卡牌属性（ATK·HP·词根技能）为纯函数规则，
 * 服务端权威判定，web/server 共用，可单测。
 * 架构预留：battle mode 字段（pve | pvp），后续 PVP 复用同一套结算。
 */
import { shuffleSeeded } from './dailyQueue';

/** 每场战斗题数（= 回合数） */
export const BATTLE_QUESTION_COUNT = 10;
/** 玩家英雄生命值（炉石式，答错被随从反击扣威胁值） */
export const HERO_MAX_HP = 30;
/** 法力水晶上限 */
export const MAX_MANA = 10;
/** 开局手牌数 */
export const HAND_SIZE = 5;
/** 手牌费用：按稀有度 */
export const CARD_COST: Record<string, number> = { SR: 1, SSR: 2, UR: 3 };
/** 连击加成封顶 */
export const COMBO_BONUS_MAX = 5;

export type BattleRarity = 'SR' | 'SSR' | 'UR';

export interface HandCard {
  wordId: string;
  wordText: string;
  phonetic?: string;
  rarity: BattleRarity;
  cost: number;
  atk: number;
  hp: number;
  /** 词根技能描述（词根家族卡才有） */
  skill?: string;
}

export interface CardStatsInput {
  /** 统一难度轴 0..100 */
  difficulty: number | null;
  rarity: BattleRarity;
  /** 是否属于某词根家族（触发技能加成） */
  hasRoot?: boolean;
}

/**
 * 词卡属性（炉石式）：
 * - 费用：SR=1 / SSR=2 / UR=3
 * - ATK：难度越高攻击越强，floor(难度/10)+1，夹 3..10；词根家族卡 +2（封顶 10）
 * - HP：4 + 费用
 */
export function cardStats(input: CardStatsInput): { cost: number; atk: number; hp: number; skill?: string } {
  const cost = CARD_COST[input.rarity] ?? 1;
  const diff = input.difficulty ?? 40;
  let atk = Math.min(10, Math.max(3, Math.floor(diff / 10) + 1));
  const hasRoot = !!input.hasRoot;
  if (hasRoot) atk = Math.min(10, atk + 2);
  const hp = 4 + cost;
  const skill = hasRoot ? '词根家族 · ATK +2' : undefined;
  return { cost, atk, hp, skill };
}

export interface BuildHandInput {
  /** 已收集词卡池（可含词根标记） */
  cards: Array<{ wordId: string; rarity: BattleRarity; difficulty: number | null; hasRoot?: boolean }>;
  count?: number;
  rng: () => number;
}

/**
 * 开局手牌：从已收集词卡随机发 count 张（默认 5）。
 * 保证至少 1 张 1 费卡（新手必能出招）；池不足循环补齐（去重）。
 */
export function buildHand(input: BuildHandInput): string[] {
  const count = input.count ?? HAND_SIZE;
  const pool = [...input.cards];
  if (pool.length === 0) return [];
  // 至少一张 1 费卡：优先保留
  const cheap = pool.filter((c) => CARD_COST[c.rarity] === 1);
  const chosen: string[] = [];
  const seen = new Set<string>();
  const pick = (c: { wordId: string }) => {
    if (seen.has(c.wordId)) return;
    seen.add(c.wordId);
    chosen.push(c.wordId);
  };
  if (cheap.length > 0) pick(cheap[Math.floor(input.rng() * cheap.length)]);
  const rest = shuffleSeeded(pool, input.rng);
  for (const c of rest) pick(c);
  // 补齐到 count（循环）
  const filled: string[] = [];
  for (let i = 0; i < count; i++) {
    filled.push(chosen[i % chosen.length]);
  }
  return filled;
}

/** 对手词灵随从威胁值（答错被反击的伤害）：难度越高威胁越大，夹 3..12 */
export function opponentThreat(difficulty: number | null): number {
  const diff = difficulty ?? 40;
  return Math.min(12, Math.max(3, Math.floor(diff / 10) + 1));
}

/**
 * 召唤伤害：随从 ATK + 连击加成（每 3 连击 +1，封顶 +5）。
 * combo=1..2 → +0；3..5 → +1；6..8 → +2；9..11 → +3；12..14 → +4；15+ → +5
 */
export function summonDamage(atk: number, combo: number): number {
  return atk + Math.min(COMBO_BONUS_MAX, Math.floor(Math.max(combo, 1) / 3));
}

/**
 * 连击伤害（旧规则，保留兼容）：1 + 每 3 连击 +1（封顶 +4）。
 * combo=1..2 → 1；3..5 → 2；6..8 → 3；9..11 → 4；12+ → 5
 */
export function damageForCombo(combo: number): number {
  return 1 + Math.min(4, Math.floor(Math.max(combo, 1) / 3));
}

export type BattleResult = 'win' | 'lose';

export interface BattleOutcomeInput {
  playerHp: number;
  bossHp: number;
  answered: number;
  total: number;
}

/**
 * 胜负判定：
 * - BOSS 血量归零 → win
 * - 玩家血量归零 → lose
 * - 题答完未分胜负 → 按剩余血量（玩家 > BOSS 才赢）
 * - 否则战斗继续（null）
 */
export function battleOutcome(input: BattleOutcomeInput): BattleResult | null {
  if (input.bossHp <= 0) return 'win';
  if (input.playerHp <= 0) return 'lose';
  if (input.answered >= input.total) return input.playerHp > input.bossHp ? 'win' : 'lose';
  return null;
}

export interface BuildBattleWordsInput {
  /** 优先池：到期复习词 */
  priority: string[];
  /** 次选池：今日计划新词 / 已学词 */
  secondary: string[];
  /** 兜底池：词书未学词（保证任何时候都能开战） */
  fallback: string[];
  count: number;
  rng: () => number;
}

/** 三级词池组题：复习优先、去重、不足循环补齐并洗牌（确定性，同 seed 可复现） */
export function buildBattleWords(input: BuildBattleWordsInput): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const ids of [input.priority, input.secondary, input.fallback]) {
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        pool.push(id);
      }
    }
  }
  if (pool.length === 0) return [];
  const filled: string[] = [];
  for (let i = 0; i < input.count; i++) {
    filled.push(pool[i % pool.length]);
  }
  return shuffleSeeded(filled, input.rng);
}
