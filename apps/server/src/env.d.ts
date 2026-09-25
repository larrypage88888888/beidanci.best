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
  /** Resend 邮件 API 密钥（生产 wrangler secret put RESEND_API_KEY）；未配置时忘记密码返回 503 */
  RESEND_API_KEY?: string;
  /** 发件人，如 "词流 WordFlow <noreply@beidanci.best>"；未配置时用 Resend 测试发件人（仅 Resend 账号本人邮箱可收） */
  EMAIL_FROM?: string;
}

/** Hono App 类型（路由与中间件共享） */
export type AppEnv = { Bindings: Env; Variables: { userId: string } };
