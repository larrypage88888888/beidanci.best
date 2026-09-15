/**
 * 每日动态组单（设计文档 §4.4，服务端权威执行）
 *
 * 每天的学习队列 =
 *   新词池（难度 ≈ 当前水平 ± 半档，控制新词数）
 *   ＋ 到期复习词（艾宾浩斯当日到期档 ∪ FSRS due）
 * 复习优先热身，新词按比例穿插，避免「先啃完所有生词」的疲劳曲线。
 */

/** 可复用的确定性伪随机数（mulberry32） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export interface DailyQueueInput {
  /** 新词候选池（服务端已按水平 ± 半档 SQL 粗筛） */
  candidateNewWordIds: string[];
  /** 到期复习词 id（due_at <= now） */
  dueReviewWordIds: string[];
  /** 用户每日新词上限 users.daily_new_limit */
  newLimit: number;
  /** 单日复习上限保护（默认 200） */
  reviewLimit?: number;
  /** 确定性种子（建议 userId+date），保证同一用户同一天重复拉取队列一致 */
  seed?: number;
}

export interface DailyQueue {
  /** 选中的新词（有序） */
  newWordIds: string[];
  /** 选中的复习词（有序） */
  reviewWordIds: string[];
  /** 前端作答顺序：复习与新词穿插后的最终序列 */
  order: string[];
}

/** 每插入一个新词前先出现的复习词数量 */
const REVIEWS_PER_NEW = 3;

export function buildDailyQueue(input: DailyQueueInput): DailyQueue {
  const rng = mulberry32(input.seed ?? 1);

  // 1) 复习词：洗牌后截断到保护上限
  const reviews = shuffleSeeded(input.dueReviewWordIds, rng).slice(0, input.reviewLimit ?? 200);

  // 2) 新词：按候选顺序取 daily_new_limit 个（服务端粗筛已保证难度贴近水平）
  const fresh = input.candidateNewWordIds.slice(0, Math.max(0, input.newLimit));

  // 3) 穿插：开头先来一小波复习热身，之后每 REVIEWS_PER_NEW 个复习插 1 个新词
  const order: string[] = [];
  let ri = 0;
  let ni = 0;

  const warmup = Math.min(3, reviews.length);
  for (; ri < warmup; ri++) order.push(reviews[ri]);

  while (ri < reviews.length || ni < fresh.length) {
    for (let k = 0; k < REVIEWS_PER_NEW && ri < reviews.length; k++, ri++) {
      order.push(reviews[ri]);
    }
    if (ni < fresh.length) {
      order.push(fresh[ni]);
      ni++;
    } else if (ri >= reviews.length) {
      break; // 两边都耗尽
    }
    if (ri >= reviews.length && ni >= fresh.length) break;
  }

  return { newWordIds: fresh, reviewWordIds: reviews, order };
}

/**
 * 按首字母分桶轮转取词：让同一天的 N 个新词首字母尽量分散。
 *
 * 背景：候选池 SQL 按难度筛选后，若直接取前 N 个，同难度档内按字母序
 * （或词库本身 a/c 打头词占比高）会导致当天新词形近词扎堆、容易记混。
 * 这里先把候选按首字母分桶、桶内与桶序都洗牌（确定性 rng），
 * 再轮转从不同桶各取一个，直到取够 N 个。
 */
export function pickByInitials(wordIds: readonly string[], n: number, rng: () => number): string[] {
  const buckets = new Map<string, string[]>();
  for (const id of wordIds) {
    const ch = id.charAt(0).toLowerCase() || '?';
    const arr = buckets.get(ch);
    if (arr) arr.push(id);
    else buckets.set(ch, [id]);
  }
  // 桶序洗牌 + 桶内洗牌（同一种子下结果确定，保证同一天重复拉取一致）
  const shuffled = shuffleSeeded([...buckets.values()], rng).map((b) => shuffleSeeded(b, rng));
  const picked: string[] = [];
  let head = 0;
  while (picked.length < n) {
    let added = false;
    for (let k = 0; k < shuffled.length && picked.length < n; k++) {
      const bucket = shuffled[(head + k) % shuffled.length];
      if (bucket.length > 0) {
        picked.push(bucket.shift() as string);
        added = true;
      }
    }
    if (!added) break; // 所有桶耗尽
    head += 1;
  }
  return picked;
}

/** 今天还剩多少新词条额（供 /api/today 展示） */
export function remainingNewQuota(newLimit: number, alreadyLearnedToday: number): number {
  return Math.max(0, newLimit - alreadyLearnedToday);
}
