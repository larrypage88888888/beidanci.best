import { Hono } from 'hono';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { userWordStates, wordRootMap, wordRoots } from '@app/db';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../lib/db';
import { loadWordsByIds } from '../lib/wordQueries';

/**
 * GET /api/roots —— 词根技能树（C9，设计文档 §10.3）
 * 学到含某词根的词 → 点亮节点；未解锁灰显。
 */
export const rootsRoutes = new Hono<AppEnv>();
rootsRoutes.use('*', requireAuth);

rootsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDb(c.env);

  const rootRows = await db.select().from(wordRoots).orderBy(asc(wordRoots.root));
  const maps = await db
    .select({ wordId: wordRootMap.wordId, root: wordRootMap.root })
    .from(wordRootMap);

  if (maps.length === 0) {
    return c.json({ roots: [], learnedWords: 0, totalRoots: rootRows.length });
  }

  const allIds = [...new Set(maps.map((m) => m.wordId))];
  const [learned, wordRows] = await Promise.all([
    db
      .select({ wordId: userWordStates.wordId })
      .from(userWordStates)
      .where(and(eq(userWordStates.userId, userId), inArray(userWordStates.wordId, allIds))),
    loadWordsByIds(db, allIds),
  ]);
  const learnedSet = new Set(learned.map((r) => r.wordId));
  const textMap = new Map(wordRows.map((w) => [w.id, w.text]));

  // root → family 词条（含点亮状态）
  const familyMap = new Map<string, Array<{ wordId: string; text: string; lit: boolean }>>();
  for (const m of maps) {
    const fam = familyMap.get(m.root) ?? [];
    fam.push({ wordId: m.wordId, text: textMap.get(m.wordId) ?? m.wordId, lit: learnedSet.has(m.wordId) });
    familyMap.set(m.root, fam);
  }

  const roots = rootRows.map((r) => {
    const family = familyMap.get(r.root) ?? [];
    const learnedCount = family.filter((f) => f.lit).length;
    return {
      root: r.root,
      affixType: r.affixType,
      meaning: r.meaning,
      emoji: r.emoji,
      total: family.length,
      learned: learnedCount,
      lit: learnedCount > 0,
      family,
    };
  });

  const learnedWords = roots.reduce((a, r) => a + r.learned, 0);
  return c.json({ roots, learnedWords, totalRoots: rootRows.length });
});
