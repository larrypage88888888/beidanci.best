import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { users } from '@app/db';
import { hashPassword, verifyPassword } from '../lib/password';
import { signJwt } from '../lib/jwt';
import { nowIso } from '../lib/time';
import { getDb } from '../lib/db';
import { passwordResetEmail, sendEmail } from '../lib/email';

const RegisterSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(8, '密码至少 8 位').max(72),
  nickname: z.string().min(1, '昵称不能为空').max(30),
});

const LoginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1),
});

/** 用户公开信息（剔除密码哈希） */
export function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    level: u.level,
    goalBookId: u.goalBookId,
    dailyNewLimit: u.dailyNewLimit,
    scheduleMode: u.scheduleMode,
    settings: JSON.parse(u.settingsJson || '{}'),
    placementDone: u.placementDone,
    createdAt: u.createdAt,
  };
}

async function issueToken(c: { env: { JWT_SECRET: string } }, userId: string): Promise<string> {
  return signJwt({ sub: userId, purpose: 'auth' }, c.env.JWT_SECRET);
}

export const authRoutes = new Hono<AppEnv>();

// POST /api/auth/register
authRoutes.post('/register', async (c) => {
  const parsed = RegisterSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const { email, password, nickname } = parsed.data;

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first();
  if (existing) {
    return c.json({ error: 'conflict', message: '该邮箱已注册' }, 409);
  }

  // 并发保护：即使上面的 SELECT 查重被两个请求同时绕过，UNIQUE 约束兜底返回 409
  let user;
  try {
    [user] = await getDb(c.env)
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        nickname,
        passwordHash: await hashPassword(password),
        goalBookId: 'cet4', // M0 默认示例词书
        createdAt: nowIso(),
      })
      .returning();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed/i.test(msg)) {
      return c.json({ error: 'conflict', message: '该邮箱已注册' }, 409);
    }
    throw e;
  }

  return c.json({ token: await issueToken(c, user.id), user: publicUser(user) }, 201);
});

// POST /api/auth/login
authRoutes.post('/login', async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const { email, password } = parsed.data;

  const [user] = await getDb(c.env).select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (!user) {
    // 区分「账号不存在」：本地开发时常因 D1 换库/重置导致账号消失，给出明确指引
    return c.json(
      {
        error: 'user_not_found',
        message: '账号不存在。如果你此前注册过，可能是本地数据库被重置/换库了（排查见 README「已知坑」）；也可以直接重新注册。',
      },
      401,
    );
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: 'bad_password', message: '邮箱或密码错误' }, 401);
  }

  return c.json({ token: await issueToken(c, user.id), user: publicUser(user) });
});

/* ── 密码重置（邮件链接）──────────────────────────────────────────
 * POST /api/auth/forgot { email }            → 发重置邮件（统一成功响应，不泄露注册状态）
 * POST /api/auth/reset  { token, password }  → 校验 KV 令牌并更新密码（一次性，30 分钟有效）
 * 令牌存 KV：key = pwreset:<sha256(token)>，value = userId，TTL 1800s。
 * DEV_MODE 下不真正发信，直接把 devLink 返回给 E2E 用。 */

const ForgotSchema = z.object({ email: z.string().email('邮箱格式不正确') });
const ResetSchema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(8, '密码至少 8 位').max(72),
});

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

authRoutes.post('/forgot', async (c) => {
  const parsed = ForgotSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const email = parsed.data.email.toLowerCase();

  // 简单防刷：同一邮箱 60 秒内只允许一次申请
  const rlKey = `pwreset-rl:${await sha256Hex(email)}`;
  if (await c.env.CACHE.get(rlKey)) {
    return c.json({ error: 'rate_limited', message: '请求太频繁，请 1 分钟后再试' }, 429);
  }
  await c.env.CACHE.put(rlKey, '1', { expirationTtl: 60 });

  const [user] = await getDb(c.env).select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const okBody = {
    ok: true,
    message: '如果该邮箱已注册，重置链接已发送，请查收邮件（也看看垃圾箱）',
  };
  if (!user) return c.json(okBody); // 不泄露注册状态

  const token = randomToken();
  await c.env.CACHE.put(`pwreset:${await sha256Hex(token)}`, user.id, { expirationTtl: 1800 });
  const link = `${new URL(c.req.url).origin}/reset-password?token=${token}`;

  if (c.env.DEV_MODE === '1') {
    return c.json({ ...okBody, devLink: link }); // 本地测试：不发信，直接回传链接
  }
  const sent = await sendEmail(c.env, { to: email, ...passwordResetEmail(link) });
  if (!sent.ok) {
    if (sent.error === 'email_not_configured') {
      return c.json({ error: 'email_not_configured', message: '邮件服务未配置，请联系管理员' }, 503);
    }
    return c.json({ error: 'email_failed', message: '邮件发送失败，请稍后再试' }, 502);
  }
  return c.json(okBody);
});

authRoutes.post('/reset', async (c) => {
  const parsed = ResetSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? '参数错误' }, 400);
  }
  const key = `pwreset:${await sha256Hex(parsed.data.token)}`;
  const userId = await c.env.CACHE.get(key);
  if (!userId) {
    return c.json({ error: 'invalid_token', message: '重置链接无效或已过期，请重新申请' }, 400);
  }
  const passwordHash = await hashPassword(parsed.data.password);
  const updated = await getDb(c.env)
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (updated.length === 0) {
    return c.json({ error: 'user_not_found', message: '用户不存在' }, 404);
  }
  await c.env.CACHE.delete(key); // 一次性使用
  return c.json({ ok: true, message: '密码已重置，请用新密码登录' });
});
