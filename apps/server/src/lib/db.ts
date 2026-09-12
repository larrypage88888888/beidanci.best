import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Env } from '../env';

/** 把 Workers 的 D1 绑定包装成 Drizzle 实例（每个请求调用一次即可） */
export function getDb(env: Env): DrizzleD1Database {
  return drizzle(env.DB);
}
