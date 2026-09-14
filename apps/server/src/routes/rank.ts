import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/auth';
import { computeUserRank } from '../lib/rankService';
import { getDb } from '../lib/db';

/**
 * GET /api/rank/current —— 段位与赛季进度（C10，设计文档 §10.3）
 * 评分 = 词汇量估算 + 近 7 天正确率 + 活跃天数；结算写入当前赛季并维护历史最高。
 */
export const rankRoutes = new Hono<AppEnv>();
rankRoutes.use('*', requireAuth);

rankRoutes.get('/current', async (c) => {
  const userId = c.get('userId');
  try {
    const payload = await computeUserRank(getDb(c.env), userId, { persist: true });
    return c.json(payload);
  } catch (err) {
    if (err instanceof Error && err.message === 'user_not_found') {
      return c.json({ error: 'not_found', message: '用户不存在' }, 404);
    }
    throw err;
  }
});
