import { Hono } from 'hono';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env';
import {
  bossEvents,
  dailyPlans,
  dailyStats,
  userBattles,
  userBossDaily,
  userCards,
  userPoints,
  userWordStates,
  users,
  wordRootMap,
  words,
} from '@app/db';
import {
  BATTLE_QUESTION_COUNT,
  DUPLICATE_POINTS,
  HAND_SIZE,
  HERO_MAX_HP,
  MAX_MANA,
  battleOutcome,
  buildBattleWords,
  buildHand,
  cardStats,
  generateQuestion,
  hashSeed,
  kindForIndex,
  mulberry32,
  opponentThreat,
  summonDamage,
} from '@app/core';
import type { HandCard, WordMeta } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { dateKeyUtc, nowIso } from '../lib/time';
import { getDb } from '../lib/db';
import { loadWordsByIds } from '../lib/wordQueries';

/**
 * 卡牌对战（炉石式 PVE 词灵对决）
 *
 * - 英雄对决：玩家 30 血 vs 词灵 BOSS 英雄血（30/35/40）
 * - 每回合对手打出一张词灵随从（= 当前题目词），你答题破解
 * - 答对 → 法力 +1，召唤手牌词卡随从攻击（伤害 = ATK + 连击加成）；答错 → 被随从反击（英雄扣威胁值）
 * - 手牌：开局从已收集词卡随机发 5 张（费用 SR1/SSR2/UR3，ATK 随难度，词根家族 +2）
 * - 服务端出题并权威判定；奖励：胜=积分+主题限定卡+抽卡次数，败=5 积分，每日每 BOSS 1 次
 * - 架构预留：mode 字段（pve | pvp），后续 PVP 复用同一套结算
 */
export const battleRoutes = new Hono<AppEnv>();
battleRoutes.use('*', requireAuth);

function parseIds(json: string | null): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseDefs(json: string | null): Array<{ pos?: string; meaning: string }> {
  try {
    return JSON.parse(json || '[]');
  } catch {
    return [];
  }
}

/** DB 词行 → core WordMeta（null 列转 undefined） */
function toWordMeta(w: Awaited<ReturnType<typeof loadWordsByIds>>[number]): WordMeta {
  return {
    id: w.id,
    text: w.text,
    ...(w.phonetic ? { phonetic: w.phonetic } : {}),
    ...(w.definitionsJson ? { definitions: parseDefs(w.definitionsJson) } : {}),
    ...(w.example ? { example: w.example } : {}),
    ...(w.exampleZh ? { exampleZh: w.exampleZh } : {}),
    ...(w.cefr ? { cefr: w.cefr as WordMeta['cefr'] } : {}),
    ...(w.frequencyRank ? { frequencyRank: w.frequencyRank } : {}),
    ...(w.difficulty != null ? { difficulty: w.difficulty } : {}),
  };
}

interface BattleQuestion {
  id: string;
  kind: string;
  wordId: string;
  wordText: string;
  difficulty: number | null;
  prompt: string;
  options?: Array<{ key: string; text: string }>;
  answerKey?: string;
  accept?: string[];
  hint?: string;
  example?: string;
  exampleZh?: string;
  phonetic?: string;
}

interface BattleState {
  questions: BattleQuestion[];
  idx: number;
  heroHp: number;
  bossHp: number;
  combo: number;
  correct: number;
  mana: number;
  hand: HandCard[];
}

/** BOSS 主题掉落词池（root=词根家族词；spell=长难词；vocab=高频词） */
async function themePool(db: ReturnType<typeof getDb>, theme: string): Promise<string[]> {
  if (theme === 'root') {
    const rows = await db.select({ wordId: wordRootMap.wordId }).from(wordRootMap).limit(120);
    return rows.map((r) => r.wordId);
  }
  if (theme === 'spell') {
    const rows = await db
      .select({ id: words.id })
      .from(words)
      .where(sql`length(${words.text}) >= 8`)
      .limit(120);
    return rows.map((r) => r.id);
  }
  // vocab：高频（低难度）
  const rows = await db
    .select({ id: words.id })
    .from(words)
    .where(and(isNotNull(words.difficulty), lte(words.difficulty, 35)))
    .orderBy(asc(words.difficulty))
    .limit(120);
  return rows.map((r) => r.id);
}

/** 开局手牌：优先已收集词卡，不足用目标词书词兜底（SR 1 费保证可出招） */
async function buildHandCards(
  db: ReturnType<typeof getDb>,
  userId: string,
  fallbackIds: string[],
  seed: number,
): Promise<HandCard[]> {
  const collected = await db
    .select({ wordId: userCards.wordId, rarity: userCards.rarity })
    .from(userCards)
    .where(eq(userCards.userId, userId))
    .limit(200);
  let raw = collected.map((c) => ({ wordId: c.wordId, rarity: c.rarity as HandCard['rarity'] }));
  if (raw.length === 0) {
    raw = fallbackIds.slice(0, 40).map((wordId) => ({ wordId, rarity: 'SR' as HandCard['rarity'] }));
  }
  const ids = [...new Set(raw.map((c) => c.wordId))].slice(0, 60);
  const wordRows = await loadWordsByIds(db, ids);
  const wordMap = new Map(wordRows.map((w) => [w.id, w]));

  let rootIds: string[] = [];
  if (ids.length > 0) {
    const roots = await db.select({ wordId: wordRootMap.wordId }).from(wordRootMap).where(inArray(wordRootMap.wordId, ids));
    rootIds = roots.map((r) => r.wordId);
  }
  const rootSet = new Set(rootIds);

  const rng = mulberry32(seed ^ 0x5f3759df);
  const picked = buildHand({
    cards: raw
      .filter((c) => wordMap.has(c.wordId))
      .map((c) => ({ wordId: c.wordId, rarity: c.rarity, difficulty: wordMap.get(c.wordId)?.difficulty ?? null, hasRoot: rootSet.has(c.wordId) })),
    count: HAND_SIZE,
    rng,
  });
  const cards: HandCard[] = [];
  for (const wordId of picked) {
    const w = wordMap.get(wordId);
    if (!w) continue;
    const r = raw.find((c) => c.wordId === wordId)?.rarity ?? 'SR';
    const stats = cardStats({ difficulty: w.difficulty, rarity: r, hasRoot: rootSet.has(wordId) });
    cards.push({
      wordId,
      wordText: w.text,
      ...(w.phonetic ? { phonetic: w.phonetic } : {}),
      rarity: r,
      cost: stats.cost,
      atk: stats.atk,
      hp: stats.hp,
      ...(stats.skill ? { skill: stats.skill } : {}),
    });
  }
  return cards;
}

// GET /api/battle/bosses —— BOSS 列表 + 今日挑战状态
battleRoutes.get('/bosses', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  const date = dateKeyUtc();

  const [bossRows, daily, stats] = await Promise.all([
    db.select().from(bossEvents).orderBy(asc(bossEvents.difficulty)),
    db
      .select()
      .from(userBossDaily)
      .where(and(eq(userBossDaily.userId, userId), eq(userBossDaily.date, date))),
    db.select().from(dailyStats).where(and(eq(dailyStats.userId, userId), eq(dailyStats.date, date))).limit(1),
  ]);

  const playedMap = new Map(daily.map((d) => [d.bossId, d.won > 0]));
  const bosses = bossRows.map((b) => ({
    id: b.id,
    name: b.name,
    emoji: b.emoji,
    theme: b.theme,
    difficulty: b.difficulty,
    hp: b.hp,
    rewardPoints: b.rewardPoints,
    rewardRarity: b.rewardRarity,
    description: b.description,
    playedToday: playedMap.has(b.id),
    wonToday: playedMap.get(b.id) ?? false,
  }));

  return c.json({
    bosses,
    battleWinsToday: stats?.[0]?.battleWins ?? 0,
    questionCount: BATTLE_QUESTION_COUNT,
    heroMaxHp: HERO_MAX_HP,
  });
});

const StartSchema = z.object({ bossId: z.string().min(1).max(40) });

// POST /api/battle/start —— 开战（占坑每日挑战 + 生成 10 题 + 发 5 张手牌）
battleRoutes.post('/start', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  const date = dateKeyUtc();
  const parsed = StartSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'bad_request', message: '参数错误' }, 400);

  const [boss] = await db.select().from(bossEvents).where(eq(bossEvents.id, parsed.data.bossId)).limit(1);
  if (!boss) return c.json({ error: 'not_found', message: 'BOSS 不存在' }, 404);

  const [played] = await db
    .select()
    .from(userBossDaily)
    .where(and(eq(userBossDaily.userId, userId), eq(userBossDaily.bossId, boss.id), eq(userBossDaily.date, date)))
    .limit(1);
  if (played) {
    return c.json({ error: 'battle_done', message: `今天已经挑战过「${boss.name}」了，明天再来吧` }, 409);
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const nowIsoStr = nowIso();

  // ── 组题三级池：到期复习 > 今日计划新词/近期已学 > 词书未学词 ──
  const dueRows = await db
    .select({ wordId: userWordStates.wordId })
    .from(userWordStates)
    .where(
      and(
        eq(userWordStates.userId, userId),
        isNotNull(userWordStates.dueAt),
        lte(userWordStates.dueAt, nowIsoStr),
        or(isNull(userWordStates.stage), ne(userWordStates.stage, 9)),
      ),
    )
    .orderBy(asc(userWordStates.dueAt))
    .limit(60);

  let planNew: string[] = [];
  const [plan] = await db
    .select({ ids: dailyPlans.newWordIdsJson })
    .from(dailyPlans)
    .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.date, date)))
    .limit(1);
  planNew = plan ? parseIds(plan.ids) : [];

  const recentRows = await db
    .select({ wordId: userWordStates.wordId })
    .from(userWordStates)
    .where(and(eq(userWordStates.userId, userId), isNotNull(userWordStates.lastReviewAt)))
    .orderBy(desc(userWordStates.lastReviewAt))
    .limit(60);
  const recentLearned = recentRows.map((r) => r.wordId);

  const bookTag = user?.goalBookId ?? 'cet4';
  const fallbackRows = await db
    .select({ id: words.id })
    .from(words)
    .where(sql`${words.tagsJson} LIKE ${`%"${bookTag}"%`}`)
    .orderBy(asc(words.id))
    .limit(60);
  const fallback = fallbackRows.map((r) => r.id);

  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const wordIds = buildBattleWords({
    priority: dueRows.map((r) => r.wordId),
    secondary: [...planNew, ...recentLearned],
    fallback,
    count: BATTLE_QUESTION_COUNT,
    rng: mulberry32(seed),
  });

  const wordRows = await loadWordsByIds(db, wordIds);
  const metas = wordRows.map(toWordMeta);
  const wordMap = new Map(metas.map((w) => [w.id, w]));

  const questions: BattleQuestion[] = [];
  for (let i = 0; i < wordIds.length; i++) {
    const word = wordMap.get(wordIds[i]);
    if (!word) continue;
    const q = generateQuestion({
      word,
      pool: metas,
      kind: kindForIndex(i),
      seed: hashSeed(`${wordIds[i]}:${boss.id}:${seed}`),
    });
    questions.push({ ...q, wordText: word.text, difficulty: word.difficulty ?? null });
  }
  if (questions.length === 0) {
    return c.json({ error: 'no_words', message: '词库还没有词，稍后再来挑战吧' }, 409);
  }

  // ── 开局手牌（已收集词卡随机发 5 张）──
  const hand = await buildHandCards(db, userId, fallback, seed);

  const state: BattleState = {
    questions,
    idx: 0,
    heroHp: HERO_MAX_HP,
    bossHp: boss.hp,
    combo: 0,
    correct: 0,
    mana: 0,
    hand,
  };

  const [inserted] = await db
    .insert(userBattles)
    .values({ userId, bossId: boss.id, status: 'pending', stateJson: JSON.stringify(state), startedAt: nowIsoStr })
    .returning();

  // 占坑每日挑战（中途放弃也消耗今日次数）
  await db
    .insert(userBossDaily)
    .values({ userId, bossId: boss.id, date, won: 0 })
    .onConflictDoNothing();

  return c.json({
    battleId: inserted.id,
    boss: { id: boss.id, name: boss.name, emoji: boss.emoji, difficulty: boss.difficulty, hp: boss.hp, rewardRarity: boss.rewardRarity },
    total: questions.length,
    turn: 1,
    heroHp: state.heroHp,
    bossHp: state.bossHp,
    mana: state.mana,
    combo: 0,
    hand,
    question: questions[0],
  });
});

const AnswerSchema = z.object({
  battleId: z.number().int().positive(),
  /** 选择题作答：'A' | 'B' | 'C' | 'D' */
  picked: z.string().min(1).max(1).optional(),
  /** 拼写题作答 */
  typed: z.string().max(80).optional(),
  /** 选中的手牌卡（出招用）；缺省时服务端自动选可用最高 ATK 卡 */
  cardId: z.string().max(40).optional(),
});

// POST /api/battle/answer —— 逐题作答（服务端权威判定，答完自动结算）
battleRoutes.post('/answer', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  const date = dateKeyUtc();
  const parsed = AnswerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'bad_request', message: '参数错误' }, 400);

  const [battle] = await db
    .select()
    .from(userBattles)
    .where(and(eq(userBattles.id, parsed.data.battleId), eq(userBattles.userId, userId)))
    .limit(1);
  if (!battle) return c.json({ error: 'not_found', message: '战斗不存在' }, 404);
  if (battle.status !== 'pending') {
    return c.json({ error: 'battle_finished', message: '这场战斗已经结束了' }, 409);
  }

  const state = JSON.parse(battle.stateJson) as BattleState;
  const q = state.questions[state.idx];
  if (!q) return c.json({ error: 'bad_request', message: '题目序号异常' }, 400);

  // 权威判定
  let correct = false;
  if (q.kind === 'spell') {
    const input = parsed.data.typed ?? '';
    correct = (q.accept ?? []).some((a) => a.trim().toLowerCase() === input.trim().toLowerCase());
  } else {
    correct = parsed.data.picked === q.answerKey;
  }

  let damage = 0;
  let threat = 0;
  let summoned: HandCard | null = null;
  if (correct) {
    state.combo += 1;
    state.correct += 1;
    state.mana = Math.min(MAX_MANA, state.mana + 1);
    // 选卡：指定且可负担 → 用之；否则自动选最高 ATK 的可负担卡；再不行用最便宜的
    const chosen =
      state.hand.find((h) => h.wordId === parsed.data.cardId && h.cost <= state.mana) ??
      state.hand.filter((h) => h.cost <= state.mana).sort((a, b) => b.atk - a.atk)[0] ??
      [...state.hand].sort((a, b) => a.cost - b.cost)[0];
    if (chosen) {
      summoned = chosen;
      state.mana -= chosen.cost;
      damage = summonDamage(chosen.atk, state.combo);
      state.bossHp = Math.max(0, state.bossHp - damage);
    }
  } else {
    state.combo = 0;
    threat = opponentThreat(q.difficulty);
    state.heroHp = Math.max(0, state.heroHp - threat);
  }
  state.idx += 1;

  const outcome = battleOutcome({
    playerHp: state.heroHp,
    bossHp: state.bossHp,
    answered: state.idx,
    total: state.questions.length,
  });

  // 未结束：存状态并返回下一题
  if (!outcome) {
    await db
      .update(userBattles)
      .set({ stateJson: JSON.stringify(state) })
      .where(and(eq(userBattles.id, battle.id), eq(userBattles.userId, userId)));
    return c.json({
      correct,
      damage,
      threat,
      combo: state.combo,
      heroHp: state.heroHp,
      bossHp: state.bossHp,
      mana: state.mana,
      answered: state.idx,
      turn: state.idx + 1,
      finished: false,
      result: null,
      summoned,
      hand: state.hand,
      next: state.questions[state.idx] ?? null,
      reveal: correct ? null : (q.wordText ?? null),
    });
  }

  // ── 结算（奖励与每日限制与既有规则一致）──
  const win = outcome === 'win';
  const [boss] = await db.select().from(bossEvents).where(eq(bossEvents.id, battle.bossId)).limit(1);
  let rewardPoints = win ? (boss?.rewardPoints ?? 30) : 5;
  let rewardWordId: string | null = null;
  let rewardRarity: string | null = null;
  let duplicate = false;
  let pointsGained = 0;

  if (win) {
    const pool = boss ? await themePool(db, boss.theme) : [];
    if (pool.length > 0) {
      rewardWordId = pool[Math.floor(Math.random() * pool.length)];
      rewardRarity = boss?.rewardRarity ?? 'SSR';
      const [existing] = await db
        .select({ wordId: userCards.wordId })
        .from(userCards)
        .where(and(eq(userCards.userId, userId), eq(userCards.wordId, rewardWordId)))
        .limit(1);
      if (existing) {
        duplicate = true;
        pointsGained = DUPLICATE_POINTS[rewardRarity as keyof typeof DUPLICATE_POINTS] ?? 0;
        rewardPoints += pointsGained;
        rewardWordId = null;
        rewardRarity = null;
      } else {
        await db.insert(userCards).values({ userId, wordId: rewardWordId, rarity: rewardRarity, obtainedAt: nowIso() });
      }
    }
  }

  await db
    .insert(userPoints)
    .values({ userId, balance: rewardPoints })
    .onConflictDoUpdate({
      target: userPoints.userId,
      set: { balance: sql`${userPoints.balance} + ${rewardPoints}` },
    });

  // 今日统计：作答计入活动（浇水/抽卡门槛/连续打卡），胜利 + 抽卡资格
  await db
    .insert(dailyStats)
    .values({
      userId,
      date,
      reviewed: state.idx,
      totalCount: state.idx,
      correctCount: state.correct,
      battleWins: win ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [dailyStats.userId, dailyStats.date],
      set: {
        reviewed: sql`${dailyStats.reviewed} + ${state.idx}`,
        totalCount: sql`${dailyStats.totalCount} + ${state.idx}`,
        correctCount: sql`${dailyStats.correctCount} + ${state.correct}`,
        battleWins: sql`${dailyStats.battleWins} + ${win ? 1 : 0}`,
      },
    });

  await db
    .update(userBossDaily)
    .set({ won: win ? 1 : 0 })
    .where(and(eq(userBossDaily.userId, userId), eq(userBossDaily.bossId, battle.bossId), eq(userBossDaily.date, date)));

  await db
    .update(userBattles)
    .set({
      status: 'finished',
      result: outcome,
      playerHp: state.heroHp,
      bossHp: state.bossHp,
      correct: state.correct,
      rewardPoints,
      rewardWordId,
      rewardRarity,
      finishedAt: nowIso(),
    })
    .where(and(eq(userBattles.id, battle.id), eq(userBattles.userId, userId)));

  const card =
    rewardWordId && rewardRarity
      ? { wordId: rewardWordId, rarity: rewardRarity, duplicate: false, pointsGained: 0 }
      : duplicate
        ? { wordId: null, rarity: null, duplicate: true, pointsGained }
        : null;

  return c.json({
    correct,
    damage,
    threat,
    combo: state.combo,
    heroHp: state.heroHp,
    bossHp: state.bossHp,
    mana: state.mana,
    answered: state.idx,
    turn: state.idx + 1,
    finished: true,
    result: outcome,
    win,
    total: state.questions.length,
    correctCount: state.correct,
    summoned,
    hand: state.hand,
    reveal: correct ? null : (q.wordText ?? null),
    reward: { points: rewardPoints, card },
  });
});
