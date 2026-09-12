import type { WordMeta } from './types';
import { mulberry32, shuffleSeeded } from './dailyQueue';

/**
 * 题型工厂（设计文档 §5 题型轮盘，M0 先做三种可判定的文本题型）
 *
 * - meaning-choice  看词选义：给出单词，四选一释义
 * - word-choice     看义选词：给出释义，四选一单词（听音选义的文本前置形态）
 * - spell           拼写默写：给出释义 + 字母提示，键入单词
 *
 * 关键性质：确定性 —— 相同的 seed 输入生成完全相同的题目，
 * 客户端可用 wordId+date 本地出题，服务端只做权威判定回写。
 */

export type QuestionKind = 'meaning-choice' | 'word-choice' | 'spell';

export const M0_QUESTION_KINDS: readonly QuestionKind[] = ['meaning-choice', 'word-choice', 'spell'] as const;

export interface ChoiceOption {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
}

export interface QuizQuestion {
  /** 建议格式 `${wordId}:${kind}:${seed}` */
  id: string;
  kind: QuestionKind;
  wordId: string;
  wordText?: string;
  phonetic?: string;
  /** 例句（含目标词）与中文翻译，卡片上高亮展示 */
  example?: string;
  exampleZh?: string;
  /** 题干（选词题为释义；拼写题亦为释义） */
  prompt: string;
  /** 选择题选项（含正确项） */
  options?: ChoiceOption[];
  /** 正确选项 key */
  answerKey?: string;
  /** 拼写题接受答案（归一化后比对） */
  accept?: string[];
  /** 拼写题字母提示，如 "a_p_e" */
  hint?: string;
}

/** 把释义列表渲染成一行展示文本 */
export function renderDefinitions(word: Pick<WordMeta, 'definitions'>): string {
  const defs = word.definitions ?? [];
  return defs.map((d) => (d.pos ? `${d.pos} ${d.meaning}` : d.meaning)).join('；');
}

/** 从候选池中挑 n 个干扰项：优先难度相近的词（更有迷惑性） */
export function pickDistractors(
  target: WordMeta,
  pool: readonly WordMeta[],
  n: number,
  rng: () => number,
): WordMeta[] {
  const targetDiff = target.difficulty ?? 50;
  const candidates = pool.filter((w) => w.id !== target.id);
  // 按难度接近度排序后取前 12 个再随机抽，兼顾迷惑性与随机性
  const sorted = [...candidates].sort((a, b) => {
    const da = Math.abs((a.difficulty ?? 50) - targetDiff);
    const db = Math.abs((b.difficulty ?? 50) - targetDiff);
    return da - db;
  });
  return shuffleSeeded(sorted.slice(0, Math.max(n * 3, n)), rng).slice(0, n);
}

export interface GenerateQuestionInput {
  word: WordMeta;
  /** 同词书候选池（用于干扰项），至少含目标词外的 3 个词 */
  pool: readonly WordMeta[];
  kind: QuestionKind;
  /** 确定性种子，建议 `${wordId}:${dateKey}` 的 hash */
  seed: number;
}

export function generateQuestion(input: GenerateQuestionInput): QuizQuestion {
  const { word, pool, kind, seed } = input;
  const rng = mulberry32(seed);
  const base: Omit<QuizQuestion, 'prompt'> = {
    id: `${word.id}:${kind}:${seed}`,
    kind,
    wordId: word.id,
    example: word.example,
    exampleZh: word.exampleZh,
  };

  if (kind === 'meaning-choice') {
    const distractors = pickDistractors(word, pool, 3, rng);
    const texts = shuffleSeeded([renderDefinitions(word), ...distractors.map(renderDefinitions)], rng);
    const options: ChoiceOption[] = texts.slice(0, 4).map((text, i) => ({
      key: (['A', 'B', 'C', 'D'] as const)[i],
      text,
    }));
    const answerKey = options.find((o) => o.text === renderDefinitions(word))?.key ?? 'A';
    return {
      ...base,
      wordText: word.text,
      phonetic: word.phonetic,
      prompt: word.text,
      options,
      answerKey,
    };
  }

  if (kind === 'word-choice') {
    const distractors = pickDistractors(word, pool, 3, rng);
    const texts = shuffleSeeded([word.text, ...distractors.map((w) => w.text)], rng);
    const options: ChoiceOption[] = texts.slice(0, 4).map((text, i) => ({
      key: (['A', 'B', 'C', 'D'] as const)[i],
      text,
    }));
    const answerKey = options.find((o) => o.text === word.text)?.key ?? 'A';
    return {
      ...base,
      prompt: renderDefinitions(word),
      options,
      answerKey,
    };
  }

  // spell
  const masked = maskWord(word.text);
  return {
    ...base,
    prompt: renderDefinitions(word),
    accept: [word.text],
    hint: masked,
  };
}

/** 保留首尾字母，中间替换为下划线；短词只留首字母 */
export function maskWord(text: string): string {
  const chars = [...text];
  if (chars.length <= 2) return chars.map((c, i) => (i === 0 ? c : '_')).join('');
  return chars.map((c, i) => (i === 0 || i === chars.length - 1 ? c : '_')).join('');
}

/** 拼写答案归一化比对：忽略大小写与首尾空白 */
export function normalizeAnswer(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function checkSpelling(question: Pick<QuizQuestion, 'accept'>, input: string): boolean {
  const normalized = normalizeAnswer(input);
  return (question.accept ?? []).some((a) => normalizeAnswer(a) === normalized);
}

/** 按序号轮换题型（防疲劳），availableKinds 缺省为 M0 三题型 */
export function kindForIndex(index: number, availableKinds: readonly QuestionKind[] = M0_QUESTION_KINDS): QuestionKind {
  return availableKinds[index % availableKinds.length];
}

/** 字符串 → 32 位种子（确定性） */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
