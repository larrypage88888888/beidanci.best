/**
 * 卡牌对战（PVE 词灵 BOSS 战）—— 用现有题型作答当「出招」：
 * 答对 → 攻击 BOSS（伤害随连击递增）；答错 → 被 BOSS 反击（玩家扣血）。
 * 纯函数规则，服务端权威判定，web/server 共用，可单测。
 * 架构预留：battle mode 字段（pve | pvp），后续 PVP 复用同一套结算。
 */
import { shuffleSeeded } from './dailyQueue';

/** 每场战斗题数 */
export const BATTLE_QUESTION_COUNT = 10;
/** 玩家生命值（答错一次 -1） */
export const PLAYER_MAX_HP = 5;

/**
 * 连击伤害：1 + 每 3 连击 +1（封顶 +4）。
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
