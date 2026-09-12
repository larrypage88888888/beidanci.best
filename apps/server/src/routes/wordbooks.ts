import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { words, wordbooks } from '@app/db';
import { requireAuth } from '../middleware/auth';
import { ensureWordDifficulties } from '../lib/difficultyPipeline';
import { getDb } from '../lib/db';

/**
 * GET /api/wordbooks               词书列表
 * GET /api/wordpack/:book/:version 词条版本包（KV 缓存，难度懒计算后整体下发）
 */
export const wordbookRoutes = new Hono<AppEnv>();
wordbookRoutes.use('/wordpack/*', requireAuth);
wordbookRoutes.use('/wordbooks', requireAuth);
wordbookRoutes.use('/wordbooks/*', requireAuth);

const VersionParam = z.coerce.number().int().positive();

wordbookRoutes.get('/wordbooks', async (c) => {
  const rows = await getDb(c.env).select().from(wordbooks);
  return c.json({ items: rows });
});

wordbookRoutes.get('/wordpack/:bookId/:version', async (c) => {
  const bookId = c.req.param('bookId');
  const parsedVersion = VersionParam.safeParse(c.req.param('version'));
  const version = parsedVersion.success ? parsedVersion.data : 1;

  const cacheKey = `pack:v1:${bookId}:${version}`;

  // KV 命中直接返回（词库包按版本不可变，缓存安全）
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json(cached);
  }

  const db = getDb(c.env);

  // 词书存在性校验
  const [book] = await db.select().from(wordbooks).where(eq(wordbooks.id, bookId)).limit(1);
  if (!book) return c.json({ error: 'not_found', message: '词书不存在' }, 404);

  // 难度懒计算（归一化管道），保证下发数据完整
  await ensureWordDifficulties(db);

  const rows = await db
    .select({
      id: words.id,
      text: words.text,
      phonetic: words.phonetic,
      definitionsJson: words.definitionsJson,
      difficulty: words.difficulty,
      cefr: words.cefr,
      frequencyRank: words.frequencyRank,
      audioUrl: words.audioUrl,
    })
    .from(words)
    .where(sql`${words.tagsJson} LIKE ${`%"${bookId}"%`}`);

  if (rows.length === 0) {
    return c.json({ error: 'not_found', message: '该词书暂无词条' }, 404);
  }

  const pack = {
    bookId,
    version,
    name: book.name,
    count: rows.length,
    items: rows.map((w) => ({
      id: w.id,
      text: w.text,
      phonetic: w.phonetic ?? undefined,
      definitions: JSON.parse(w.definitionsJson || '[]'),
      difficulty: w.difficulty ?? undefined,
      cefr: w.cefr ?? undefined,
      frequencyRank: w.frequencyRank ?? undefined,
      audioUrl: w.audioUrl ?? undefined,
    })),
  };

  // 写入 KV 缓存 1 小时（免费额度友好）
  await c.env.CACHE.put(cacheKey, JSON.stringify(pack), { expirationTtl: 3600 });

  return c.json(pack);
});
