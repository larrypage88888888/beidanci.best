import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './env';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { placementRoutes } from './routes/placement';
import { todayRoutes } from './routes/today';
import { reviewsRoutes } from './routes/reviews';
import { wordbookRoutes } from './routes/wordbooks';
import { devRoutes } from './routes/dev';
import { myWordsRoutes } from './routes/myWords';
import { materializeAllPlans } from './cron/materializePlans';

/** Hono 应用组装（设计文档 §六·主要 API 面） */
const app = new Hono<AppEnv>();

// 开发期 CORS 放开；生产建议收敛到自己的前端域名
app.use('/api/*', cors());

app.onError((err, c) => {
  console.error('unhandled error:', err);
  return c.json({ error: 'internal', message: '服务内部错误' }, 500);
});

// 健康检查：dbInstance 是数据库实例身份（app_meta.instance_id），
// 值变化 = 该环境的数据被重置/换库（本地 D1 常见），用于排查「账号消失」。
app.get('/api/health', async (c) => {
  let dbInstance: string | null = null;
  try {
    const row = (await c.env.DB.prepare("SELECT value FROM app_meta WHERE key = 'instance_id'").first()) as
      | { value?: string }
      | null
      | undefined;
    dbInstance = row?.value ?? null;
  } catch {
    dbInstance = null; // app_meta 不存在 = 该库从未执行迁移
  }
  return c.json({ ok: true, ts: Date.now(), dbInstance, migrated: dbInstance !== null });
});

app.route('/api/auth', authRoutes);
app.route('/api/me', meRoutes);
app.route('/api/placement', placementRoutes);
app.route('/api/today', todayRoutes);
app.route('/api/reviews', reviewsRoutes);
app.route('/api', wordbookRoutes);
app.route('/api/words', myWordsRoutes);
app.route('/api/dev', devRoutes);

export default {
  fetch: app.fetch,

  /** Cron Triggers：每日计划预物化 */
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      materializeAllPlans(env.DB).catch((err) => {
        console.error('scheduled materialize failed:', err);
      }),
    );
  },
};
