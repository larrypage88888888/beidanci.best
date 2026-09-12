/// <reference types="@cloudflare/workers-types" />

/** Worker 绑定与环境变量 */
export interface Env {
  /** D1 数据库（用户/状态/日志） */
  DB: D1Database;
  /** KV（词库包 / 结果缓存） */
  CACHE: KVNamespace;
  /** JWT 签名密钥（本地 .dev.vars；生产 wrangler secret put JWT_SECRET） */
  JWT_SECRET: string;
  /** 置 '1' 时开放本地测试工具接口（/api/dev/*），生产环境绝不设置 */
  DEV_MODE?: string;
}

/** Hono App 类型（路由与中间件共享） */
export type AppEnv = { Bindings: Env; Variables: { userId: string } };
