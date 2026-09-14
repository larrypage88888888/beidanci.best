import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { D1Database } from '@cloudflare/workers-types';
import { users } from '@app/db';
import { computeUserRank } from '../lib/rankService';

/**
 * Cron 月度段位结算（设计文档 §10.3）：每月 1 号把所有用户当前赛季结算落库，
 * 并刷新历史最高段位（段位解锁词书的依据）。
 */
export async function settleAllRanks(dbRaw: D1Database): Promise<{ users: number; settled: number }> {
  const db = drizzle(dbRaw) as unknown as DrizzleD1Database;
  const userRows = await db.select({ id: users.id }).from(users).limit(1000);
  let settled = 0;
  for (const u of userRows) {
    try {
      await computeUserRank(db, u.id, { persist: true });
      settled += 1;
    } catch (err) {
      console.error(`rank settle failed for user ${u.id}:`, err);
    }
  }
  return { users: userRows.length, settled };
}
