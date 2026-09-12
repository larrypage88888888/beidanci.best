import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../env';
import { users } from '@app/db';
import { verifyJwt } from '../lib/jwt';
import { getDb } from '../lib/db';

/**
 * Bearer JWT 鉴权中间件：通过后 c.set('userId', ...)
 * 除验签外还确认用户仍存在 —— 数据库重置/账号被删时，
 * 旧 token 返回 401（而非后续路由的 404/500），前端可自动登出引导重新登录。
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized', message: '缺少 Bearer Token' }, 401);
  }
  const payload = await verifyJwt(header.slice(7), c.env.JWT_SECRET, 'auth');
  if (!payload?.sub) {
    return c.json({ error: 'unauthorized', message: 'Token 无效或已过期' }, 401);
  }

  const db = getDb(c.env);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.sub)).limit(1);
  if (!user) {
    return c.json({ error: 'unauthorized', message: '账号不存在或已被重置，请重新注册/登录' }, 401);
  }

  c.set('userId', payload.sub);
  await next();
});
