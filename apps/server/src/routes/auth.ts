import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { users } from '@app/db';
import { hashPassword, verifyPassword } from '../lib/password';
import { signJwt } from '../lib/jwt';
import { nowIso } from '../lib/time';
import { getDb } from '../lib/db';

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

  const [user] = await getDb(c.env)
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
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return c.json({ error: 'invalid_credentials', message: '邮箱或密码错误' }, 401);
  }

  return c.json({ token: await issueToken(c, user.id), user: publicUser(user) });
});
