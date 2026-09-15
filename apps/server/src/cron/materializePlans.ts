import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { users } from '@app/db';
import { dateKeyCn } from '../lib/time';
import { getOrBuildTodayPlan } from '../lib/todayBuilder';
import { ensureWordDifficulties } from '../lib/difficultyPipeline';

/**
 * Cron 每日计划预物化（设计文档 §二·定时任务）：
 * UTC 16:30（北京时间 00:30）为所有活跃用户物化当天队列，
 * 用户早上打开 App 即秒开今日词单。
 */
export async function materializeAllPlans(dbRaw: D1Database): Promise<{ users: number; built: number }> {
  const db = drizzle(dbRaw) as unknown as DrizzleD1Database;
  await ensureWordDifficulties(db);

  const userRows = await db.select({ id: users.id }).from(users).limit(500);
  let built = 0;

  const date = dateKeyCn();
  for (const u of userRows) {
    try {
      const plan = await getOrBuildTodayPlan(db, u.id, date);
      if (plan?.created) built += 1;
    } catch (err) {
      // 单个用户失败不阻塞整体物化
      console.error(`materialize failed for user ${u.id}:`, err);
    }
  }

  return { users: userRows.length, built };
}
