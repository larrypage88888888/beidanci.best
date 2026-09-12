import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { users } from '@app/db';
import {
  answerPlacement,
  finishPlacement,
  isPlacementDone,
  pickPlacementWord,
  startPlacement,
} from '@app/core';
import type { PlacementSession, WordMeta } from '@app/core';
import { requireAuth } from '../middleware/auth';
import { signJwt, verifyJwt } from '../lib/jwt';
import { ensureWordDifficulties } from '../lib/difficultyPipeline';
import { loadPlacementCandidates } from '../lib/wordQueries';
import { getDb } from '../lib/db';

/**
 * POST /api/placement/start   开始摸底（返回第一题）
 * POST /api/placement/answer  提交一题（返回下一题或最终结果）
 *
 * 自适应会话状态经 HMAC 签名后放在 sessionToken 里由客户端携带，
 * 服务端不存会话 —— 无状态、天然水平扩展；篡改会被签名校验拒绝。
 */
export const placementRoutes = new Hono<AppEnv>();
placementRoutes.use('*', requireAuth);

const AnswerSchema = z.object({
  sessionToken: z.string().min(10),
  wordId: z.string().min(1),
  correct: z.boolean(),
});

async function loadSession(
  token: string,
  secret: string,
): Promise<PlacementSession | null> {
  const payload = await verifyJwt(token, secret, 'placement');
  if (!payload || typeof payload.s !== 'object' || payload.s === null) return null;
  return payload.s as PlacementSession;
}

async function issueSessionToken(secret: string, session: PlacementSession): Promise<string> {
  // 摸底会话 30 分钟有效
  return signJwt({ purpose: 'placement', s: session }, secret, 30 * 60);
}

async function nextQuestion(
  db: DrizzleD1Database,
  secret: string,
  session: PlacementSession,
): Promise<{ question: { wordId: string; text: string }; sessionToken: string }> {
  const candidates = await loadPlacementCandidates(db, {
    estimate: session.estimate,
    excludeIds: session.askedWordIds,
    limit: 30,
  });
  if (candidates.length === 0) {
    throw new Error('词库候选不足，请先完成词书种子导入');
  }
  const word = pickPlacementWord(session, candidates as WordMeta[]);
  if (!word) throw new Error('词库候选不足');

  const nextSession: PlacementSession = {
    ...session,
    askedWordIds: [...session.askedWordIds, word.id],
  };

  return {
    question: { wordId: word.id, text: word.text },
    sessionToken: await issueSessionToken(secret, nextSession),
  };
}

// POST /api/placement/start
placementRoutes.post('/start', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);
  await ensureWordDifficulties(db);

  const emptySession = startPlacement();
  const q = await nextQuestion(db, c.env.JWT_SECRET, emptySession);

  // 标记用户重新开始摸底（结果在 finish 时写入）
  await db.update(users).set({ placementDone: false }).where(eq(users.id, userId));

  return c.json({ question: q.question, progress: { current: 1, total: 20 }, sessionToken: q.sessionToken });
});

// POST /api/placement/answer
placementRoutes.post('/answer', async (c) => {
  const parsed = AnswerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: '参数错误' }, 400);
  }
  const { sessionToken, wordId, correct } = parsed.data;

  const session = await loadSession(sessionToken, c.env.JWT_SECRET);
  if (!session) {
    return c.json({ error: 'invalid_session', message: '摸底会话无效，请重新开始' }, 409);
  }

  // 校验作答的确实是最近下发的题，且拿到服务端权威难度
  const lastAsked = session.askedWordIds[session.askedWordIds.length - 1];
  if (wordId !== lastAsked) {
    return c.json({ error: 'stale_answer', message: '该题不属于当前会话进度' }, 409);
  }
  const row = await c.env.DB.prepare('SELECT difficulty FROM words WHERE id = ?')
    .bind(wordId)
    .first<{ difficulty: number | null }>();
  if (row?.difficulty == null) {
    return c.json({ error: 'word_not_ready', message: '词条难度未就绪' }, 500);
  }

  const updated = answerPlacement(session, row.difficulty, correct);

  if (!isPlacementDone(updated)) {
    const q = await nextQuestion(getDb(c.env), c.env.JWT_SECRET, updated);
    return c.json({
      done: false,
      question: q.question,
      progress: { current: updated.questionCount + 1, total: 20 },
      sessionToken: q.sessionToken,
    });
  }

  // 完成：写回用户水平
  const result = finishPlacement(updated);
  const userId = c.get('userId');
  await getDb(c.env)
    .update(users)
    .set({ level: result.level, placementDone: true })
    .where(eq(users.id, userId));

  return c.json({ done: true, result });
});
