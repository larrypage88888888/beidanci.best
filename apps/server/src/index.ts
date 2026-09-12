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

// 健康检查
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

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
