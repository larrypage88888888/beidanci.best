import type { CefrLevel, WordMeta } from './types';
import { difficultyToCefr } from './difficulty';

/**
 * 自适应摸底测试（设计文档 §4.2）
 *
 * 首次使用做约 20 题，答对升难度、答错降难度，逐步收敛，
 * 输出预估词汇量 + 初始等级。纯逻辑层：会话状态可由服务端
 * 签名后交给客户端保存（无状态水平扩展），也可存 KV/DB。
 */

export interface PlacementSession {
  /** 已问过的词 id（有序） */
  askedWordIds: string[];
  /** 当前能力估计（难度轴 0..100），初始 50 */
  estimate: number;
  /** 当前步长，每题衰减 */
  step: number;
  /** 已答题数 */
  questionCount: number;
  /** 总题数上限 */
  maxQuestions: number;
  /** 答对题数 */
  correctCount: number;
}

export interface PlacementResult {
  /** 最终能力估计（难度轴 0..100），写入 users.level */
  level: number;
  /** 预估词汇量 */
  vocabEstimate: number;
  /** 对应 CEFR 档位 */
  cefr: CefrLevel;
  correctCount: number;
  questionCount: number;
}

export const PLACEMENT_MAX_QUESTIONS = 20;
const INITIAL_ESTIMATE = 50;
const INITIAL_STEP = 18;
const STEP_DECAY = 0.72;

export function startPlacement(maxQuestions = PLACEMENT_MAX_QUESTIONS): PlacementSession {
  return {
    askedWordIds: [],
    estimate: INITIAL_ESTIMATE,
    step: INITIAL_STEP,
    questionCount: 0,
    maxQuestions,
    correctCount: 0,
  };
}

/**
 * 从候选池中挑下一道摸底题：选难度最接近当前估计且未问过的词。
 * 加入确定性抖动避免题目序列可预测。
 */
export function pickPlacementWord(session: PlacementSession, pool: WordMeta[]): WordMeta | null {
  const asked = new Set(session.askedWordIds);
  const candidates = pool.filter((w) => !asked.has(w.id));
  if (candidates.length === 0) return null;

  const jitter = ((session.questionCount * 37) % 11) - 5; // -5..+5 的确定性抖动
  const target = clamp(session.estimate + jitter, 0, 100);

  let best: WordMeta | null = null;
  let bestDelta = Infinity;
  for (const w of candidates) {
    const d = w.difficulty ?? 50;
    const delta = Math.abs(d - target);
    if (delta < bestDelta) {
      best = w;
      bestDelta = delta;
    }
  }
  return best;
}

/** 提交一道摸底题的作答，推进自适应过程 */
export function answerPlacement(
  session: PlacementSession,
  wordDifficulty: number,
  correct: boolean,
): PlacementSession {
  const direction = correct ? 1 : -1;
  // 向作答词难度方向修正估计；答错时以该词难度为下界的近似
  const moved = correct
    ? session.estimate + direction * session.step * 0.6
    : Math.min(session.estimate, wordDifficulty) - session.step * 0.35;

  return {
    ...session,
    askedWordIds: [...session.askedWordIds],
    estimate: clamp(moved, 0, 100),
    step: Math.max(2, session.step * STEP_DECAY),
    questionCount: session.questionCount + 1,
    correctCount: session.correctCount + (correct ? 1 : 0),
  };
}

/** 词汇量锚点：(难度轴位置 → 预估词汇量)，分段线性插值 */
const VOCAB_ANCHORS: Array<[number, number]> = [
  [0, 100],
  [20, 600],
  [40, 2000],
  [55, 3800],
  [70, 5800],
  [85, 9000],
  [100, 16000],
];

export function estimateVocabSize(level: number): number {
  const x = clamp(level, 0, 100);
  for (let i = 1; i < VOCAB_ANCHORS.length; i++) {
    const [x1, y1] = VOCAB_ANCHORS[i];
    const [x0, y0] = VOCAB_ANCHORS[i - 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return VOCAB_ANCHORS[VOCAB_ANCHORS.length - 1][1];
}

/** 结束摸底，输出最终结果 */
export function finishPlacement(session: PlacementSession): PlacementResult {
  const level = Math.round(clamp(session.estimate, 0, 100) * 10) / 10;
  return {
    level,
    vocabEstimate: estimateVocabSize(level),
    cefr: difficultyToCefr(level),
    correctCount: session.correctCount,
    questionCount: session.questionCount,
  };
}

/** 会话是否已到结束条件（答满或步长收敛） */
export function isPlacementDone(session: PlacementSession): boolean {
  return session.questionCount >= session.maxQuestions || (session.questionCount >= 8 && session.step <= 2.5);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
