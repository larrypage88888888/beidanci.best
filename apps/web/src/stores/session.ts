import { create } from 'zustand';
import {
  createInitialState,
  generateQuestion,
  hashSeed,
  kindForIndex,
  newCombo,
  nextCombo,
  schedule,
} from '@app/core';
import type { CardState, QuestionKind, QuizQuestion, Rating, ScheduleMode } from '@app/core';
import { api } from '../lib/api';
import type { CardDrawInfo, PetInfo, TodayItem, TodayResponse } from '../lib/types';

/**
 * 学习会话状态机（设计文档：客户端乐观预计算 + 服务端异步确认）
 *
 * - 队列来自 GET /api/today（服务端按艾宾浩斯到期状态动态计算）
 * - 题目用共享 @app/core 题型工厂本地确定性生成
 * - 作答后本地乐观调度更新镜像，攒批 POST /api/reviews
 * - 服务端权威结果回写镜像并校正 streak/徽章
 * - 完成后 refreshQueue 轮询：新词到点（5 分钟快闪等）自动续上新一轮
 */

type Phase = 'idle' | 'loading' | 'preview' | 'learning' | 'submitting' | 'relearn' | 'done' | 'error';

export interface SessionSummary {
  total: number;
  remembered: number;
  fuzzy: number;
  forgot: number;
  graduated: number;
}

interface SessionState {
  phase: Phase;
  date: string;
  mode: ScheduleMode;
  items: Map<string, TodayItem>;
  questions: QuizQuestion[];
  idx: number;
  /** 客户端乐观镜像（服务端结果会覆盖校正） */
  mirror: Record<string, CardState>;
  buffer: Array<{ wordId: string; rating: Rating; latencyMs: number }>;
  summary: SessionSummary;
  streak: number;
  newQuotaUsed: number;
  newQuotaLimit: number;
  error: string | null;
  /** 本轮答错的词（忘记/模糊），队列结束后进入「错词重学」 */
  wrongIds: string[];
  /** 待重学的错词队列（队首=当前展示的学习卡） */
  relearnQueue: string[];
  /** 当前是否处于重学考试轮（用于头部徽章标识） */
  inRelearnRound: boolean;
  /** 每个词已重考的次数（wordId → 次数），卡片上显示第几遍 */
  relearnAttempts: Record<string, number>;
  /** 预习词卡待展示的词（队首=当前卡）；仅当队列含新词时启用 */
  previewIds: string[];
  /** 本轮预习的总卡数（预习进度展示用） */
  previewTotal: number;
  /** 会话内连击（答对+1/答错归零；best 用于当日纪录与抽卡加成） */
  combo: { count: number; best: number };
  /** 服务端回写的词苗状态（P0 §十） */
  pet: PetInfo | null;
  /** 今日抽卡资格（P0 §十） */
  cardDraw: CardDrawInfo | null;
  /** 持有的复活卡数量 */
  reviveCards: number;

  loadToday: (mode?: 'normal' | 'redo') => Promise<void>;
  /** 完成页轮询：有新到期词则续上新一轮，返回是否恢复学习 */
  refreshQueue: () => Promise<boolean>;
  answer: (rating: Rating) => Promise<void>;
  skipFlush: () => Promise<void>;
  /** 重学卡片点「出题考我」：为当前词生成新题并进入答题 */
  acceptRelearn: () => void;
  /** 独立预习：只翻今天剩余新词的预习卡（与做题流程分开），翻完可一键进入做题 */
  startPreview: () => void;
  /** 预习词卡「下一个」；最后一张后进入做题 */
  advancePreview: () => void;
  /** 跳过剩余预习词卡，直接进入做题 */
  skipPreview: () => void;
  resetError: () => void;
}

let questionStartAt = 0;
/** 回写失败后的自动重试定时器（避免重复堆叠） */
let flushRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** 回写是否在途（防止 online 事件/连点重试与在途提交并发导致同一批双发） */
let flushInFlight = false;
const FLUSH_RETRY_MS = 6_000;

/** 由 /api/today 响应构建本地确定性题目 */
function buildQuestions(t: TodayResponse): { items: Map<string, TodayItem>; questions: QuizQuestion[] } {
  const items = new Map(t.items.map((w) => [w.id, w]));
  const pool = t.items;
  const questions = t.remainingOrder.map((wordId, i) => {
    const item = items.get(wordId);
    const kind: QuestionKind = kindForIndex(i);
    const fallback: TodayItem = { id: wordId, text: wordId, definitions: [{ meaning: '' }] };
    return generateQuestion({
      word: item ?? fallback,
      pool,
      kind,
      seed: hashSeed(`${t.date}:${wordId}:${i}`),
    });
  });
  return { items, questions };
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  phase: 'idle',
  date: '',
  mode: 'ebbinghaus',
  items: new Map(),
  questions: [],
  idx: 0,
  mirror: {},
  buffer: [],
  summary: { total: 0, remembered: 0, fuzzy: 0, forgot: 0, graduated: 0 },
  streak: 0,
  newQuotaUsed: 0,
  newQuotaLimit: 10,
  error: null,
  wrongIds: [],
  relearnQueue: [],
  inRelearnRound: false,
  relearnAttempts: {},
  previewIds: [],
  previewTotal: 0,
  combo: newCombo(),
  pet: null,
  cardDraw: null,
  reviveCards: 0,

  resetError: () => set({ error: null }),

  loadToday: async (mode = 'normal') => {
    if (get().phase === 'loading') return;
    set({ phase: 'loading', error: null });
    try {
      const t = await api.today(mode);
      const { items, questions } = buildQuestions(t);
      questionStartAt = Date.now();

      // 学习与预习分开：直接进入做题；预习由用户从独立入口（startPreview）进入
      set({
        phase: questions.length === 0 ? 'done' : 'learning',
        date: t.date,
        mode: t.scheduleMode,
        items,
        questions,
        idx: 0,
        mirror: {},
        buffer: [],
        streak: t.streak,
        newQuotaUsed: t.newQuota.used,
        newQuotaLimit: t.newQuota.limit,
        summary: { total: 0, remembered: 0, fuzzy: 0, forgot: 0, graduated: 0 },
        wrongIds: [],
        relearnQueue: [],
        inRelearnRound: false,
        relearnAttempts: {},
        previewIds: [],
        previewTotal: 0,
        combo: newCombo(),
        pet: null,
        cardDraw: null,
        reviveCards: 0,
      });
    } catch (err) {
      // 终态 'error'（不回 idle）：避免 TodayPage 的 idle→loading 循环无限重试
      set({ phase: 'error', error: err instanceof Error ? err.message : '加载今日队列失败' });
    }
  },

  refreshQueue: async () => {
    const s = get();
    // 学习中不需要轮询；避免与 loading 并发
    if (s.phase === 'loading') return false;
    try {
      const t = await api.today();
      if ((t.remainingOrder?.length ?? 0) === 0) {
        // 没有新到期词 → 保持完成画面（不清空总结）
        set({ streak: t.streak });
        return false;
      }
      const { items, questions } = buildQuestions(t);
      questionStartAt = Date.now();
      set({
        phase: 'learning',
        date: t.date,
        mode: t.scheduleMode,
        items,
        questions,
        idx: 0,
        mirror: {},
        buffer: [],
        streak: t.streak,
        newQuotaUsed: t.newQuota.used,
        newQuotaLimit: t.newQuota.limit,
        error: null,
        wrongIds: [],
        relearnQueue: [],
        inRelearnRound: false,
        relearnAttempts: {},
        previewIds: [],
        previewTotal: 0,
        combo: newCombo(),
        pet: null,
        cardDraw: null,
        reviveCards: 0,
      });
      return true;
    } catch {
      return false; // 静默失败，下个周期再试
    }
  },

  answer: async (rating) => {
    const s = get();
    const q = s.questions[s.idx];
    if (!q || s.phase !== 'learning') return;

    const latencyMs = Math.min(Date.now() - questionStartAt, 600_000); // 停留过久按 10 分钟计，避免遥测值离谱
    questionStartAt = Date.now();

    // 1) 乐观调度（本地镜像；首答视为新卡，服务端稍后校正）
    const prev = s.mirror[q.wordId] ?? createInitialState(q.wordId, s.mode);
    const result = schedule(prev, rating);

    // 2) 攒批；答错（忘记/模糊）→ 记入错词（含重学轮：反复错就反复学，直到答对）
    const buffer = [...s.buffer, { wordId: q.wordId, rating, latencyMs }];
    const wrongIds =
      rating !== 'remembered' && !s.wrongIds.includes(q.wordId)
        ? [...s.wrongIds, q.wordId]
        : s.wrongIds;

    set({
      mirror: { ...s.mirror, [q.wordId]: result.next },
      buffer,
      wrongIds,
      combo: nextCombo(s.combo, rating === 'remembered'),
      idx: s.idx + 1,
      summary: {
        total: s.summary.total + 1,
        remembered: s.summary.remembered + (rating === 'remembered' ? 1 : 0),
        fuzzy: s.summary.fuzzy + (rating === 'fuzzy' ? 1 : 0),
        forgot: s.summary.forgot + (rating === 'forgot' ? 1 : 0),
        // graduated 不做乐观累加：由服务端权威结果在 flushBuffer 确认后 +1，避免双计
        graduated: s.summary.graduated,
      },
      phase: s.idx + 1 >= s.questions.length ? 'submitting' : 'learning',
    });

    // 3) 攒满 5 条或队列结束 → 批量回写
    if (buffer.length >= 5 || get().phase === 'submitting') {
      await flushBuffer(set, get);
    }
  },

  skipFlush: async () => {
    await flushBuffer(set, get);
  },

  acceptRelearn: () => {
    const s = get();
    const wordId = s.relearnQueue[0];
    const item = wordId ? s.items.get(wordId) : undefined;
    if (!wordId || !item) {
      // 异常兜底：没有可重学的词就直接收尾
      set({ relearnQueue: [], phase: 'done', inRelearnRound: false });
      return;
    }

    // 为错词现场生成一道新题（随机题型，种子含时间避免与原题雷同）
    const kinds: QuestionKind[] = ['meaning-choice', 'word-choice', 'spell'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)] ?? 'meaning-choice';
    const question = generateQuestion({
      word: item,
      pool: [...s.items.values()],
      kind,
      seed: hashSeed(`${s.date}:${wordId}:relearn:${Date.now() % 1_000_000}`),
    });
    questionStartAt = Date.now();

    set({
      questions: [question],
      idx: 0,
      buffer: [],
      inRelearnRound: true,
      relearnQueue: s.relearnQueue.slice(1),
      relearnAttempts: { ...s.relearnAttempts, [wordId]: (s.relearnAttempts[wordId] ?? 0) + 1 },
      phase: 'learning',
    });
  },

  /** 独立预习：只翻当前队列里还没作答的新词预习卡；与做题流程完全分开 */
  startPreview: () => {
    const s = get();
    if (s.phase !== 'learning' && s.phase !== 'done') return;
    const ids = new Set<string>();
    for (let i = s.idx; i < s.questions.length; i++) {
      const item = s.items.get(s.questions[i].wordId);
      if (item?.entry === 'new') ids.add(item.id);
    }
    const unique = [...ids];
    if (unique.length === 0) return;
    set({ previewIds: unique, previewTotal: unique.length, phase: 'preview' });
  },

  advancePreview: () => {
    const rest = get().previewIds.slice(1);
    if (rest.length === 0) {
      // 预习完毕：从现在开始计时答题耗时
      questionStartAt = Date.now();
      set({ previewIds: [], phase: 'learning' });
    } else {
      set({ previewIds: rest });
    }
  },

  skipPreview: () => {
    questionStartAt = Date.now();
    set({ previewIds: [], phase: 'learning' });
  },
}));

async function flushBuffer(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): Promise<void> {
  // 在途保护：同一批作答只提交一次（online 事件/「立即重试」连点可能与在途提交并发）
  if (flushInFlight) return;
  const s = get();
  if (s.buffer.length === 0) {
    if (flushRetryTimer) {
      clearTimeout(flushRetryTimer);
      flushRetryTimer = null;
    }
    if (s.phase === 'submitting') set(settlePhase(s));
    return;
  }

  flushInFlight = true;
  set({ phase: 'submitting' });
  try {
    const res = await api.submitReviews(s.buffer, get().combo.best);
    // 成功：取消待执行的重试
    if (flushRetryTimer) {
      clearTimeout(flushRetryTimer);
      flushRetryTimer = null;
    }
    // 服务端权威结果覆盖本地乐观镜像
    const mirror = { ...get().mirror };
    let graduated = 0;
    for (const r of res.results) {
      const local = mirror[r.wordId];
      mirror[r.wordId] = {
        ...(local ?? createInitialState(r.wordId, s.mode)),
        stage: r.stage,
        stability: r.stability,
        fsrsDifficulty: r.fsrsDifficulty,
        dueAt: r.dueAt,
        reps: r.reps,
      };
      if (r.graduated) graduated += 1;
    }
    set({
      mirror,
      buffer: [],
      error: null,
      streak: res.streak,
      pet: res.pet ?? get().pet,
      cardDraw: res.cardDraw ?? get().cardDraw,
      reviveCards: res.reviveCards ?? get().reviveCards,
      summary: { ...get().summary, graduated: get().summary.graduated + graduated },
      ...settlePhase(get()),
    });
  } catch (err) {
    // 回写失败：保留 buffer，6 秒后自动重试（弱网兜底，设计文档 §二.4）
    set({
      phase: get().idx >= get().questions.length ? 'submitting' : 'learning',
      error: err instanceof Error ? `回写失败，稍后自动重试：${err.message}` : '回写失败',
    });
    scheduleFlushRetry(set, get);
  } finally {
    flushInFlight = false;
  }
}

function scheduleFlushRetry(
  set: (partial: Partial<SessionState>) => void,
  get: () => SessionState,
): void {
  if (flushRetryTimer) return; // 已有待执行的重试
  flushRetryTimer = setTimeout(() => {
    flushRetryTimer = null;
    const s = get();
    // 队尾回写失败 phase 是 'submitting'，用 in-flight 标志而非 phase 判断，
    // 否则队尾失败的自动重试会被永久判死
    if (s.buffer.length > 0 && !flushInFlight) {
      void flushBuffer(set, get);
    }
  }, FLUSH_RETRY_MS);
}

/** 队列答完后的去向：还有错词→追加到重学队尾循环学习；队列清空才进入完成 */
function settlePhase(s: SessionState): Partial<SessionState> {
  if (s.idx < s.questions.length) return { phase: 'learning' };
  if (s.wrongIds.length > 0) {
    // 重学轮再错的词追加到队尾（去重），先处理完剩余的再回来
    const merged = [...s.relearnQueue];
    for (const id of s.wrongIds) if (!merged.includes(id)) merged.push(id);
    return { phase: 'relearn', relearnQueue: merged, wrongIds: [] };
  }
  if (s.relearnQueue.length > 0) return { phase: 'relearn' };
  return { phase: 'done', inRelearnRound: false };
}
