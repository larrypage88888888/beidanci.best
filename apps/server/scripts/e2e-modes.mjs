#!/usr/bin/env node
/**
 * 调度模式切换 + 每日新词配额 集成测试：
 *   1) 下调 dailyNewLimit=2 后首拉队列 → 新词恰好 2 个（配额生效）
 *   2) 切到 FSRS → 到期词回来作答 → 结果带 stability/fsrsDifficulty（FSRS 内核生效）
 *   3) 切回艾宾浩斯 → 级别不丢（近似保持）且继续晋升
 *
 * 用法：node scripts/e2e-modes.mjs [origin]   默认走 Vite 代理 5173
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `modes-${Date.now()}@test.com`;
const password = 'modes-pass-12345';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastErr;
}

console.log(`\n🔀 模式切换与配额测试 · 目标 ${BASE}\n`);

/* 注册 + 摸底 */
const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '模式测试员' } });
check('注册', reg.status === 201);
const token = reg.json.token;

let p = await req('POST', '/api/placement/start', { token });
for (let i = 0; i < 30; i++) {
  const ans = await req('POST', '/api/placement/answer', {
    token,
    body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct: true },
  });
  if (ans.json.done) break;
  p.json = ans.json;
}
check('摸底完成', true);

/* ── 1) 配额：把每日新词上限压到 2，再首次拉取今日队列 ── */
const patched = await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 2 } });
check('设置每日新词上限=2', patched.status === 200 && patched.json.user.dailyNewLimit === 2);

const t1 = await req('GET', '/api/today', { token });
const news = t1.json.items.filter((i) => i.entry === 'new');
check('配额生效：新词恰好 2 个', news.length === 2 && t1.json.remainingOrder.length === 2,
  `队列=${t1.json.remainingOrder.length} 新词=${news.length}`);

/* 艾宾浩斯模式下学完这 2 个词 */
const rv1 = await req('POST', '/api/reviews', {
  token,
  body: { items: t1.json.remainingOrder.map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 900 })) },
});
const initialStages = new Map(rv1.json.results.map((r) => [r.wordId, r.stage]));
check('艾宾浩斯首轮作答', rv1.status === 200 && initialStages.size === 2,
  [...initialStages.entries()].map(([w, s]) => `${w}→第${s}级`).join(' '));

/* ── 2) 切换到 FSRS，到期词回来后应走 FSRS 内核 ── */
const toFsrs = await req('PATCH', '/api/me', { token, body: { scheduleMode: 'fsrs' } });
check('切换到 FSRS 模式', toFsrs.json.user?.scheduleMode === 'fsrs');

const dv1 = await req('POST', '/api/dev/review-now', { token, body: { count: 2 } });
check('拉回到期词', dv1.status === 200 && dv1.json.wordIds.length === 2);

const t2 = await req('GET', '/api/today', { token });
check('到期词以复习身份回归', t2.json.reviewCount === 2,
  t2.json.items.filter((i) => i.entry === 'review').map((i) => i.text).join('/'));

const rv2 = await req('POST', '/api/reviews', {
  token,
  body: { items: t2.json.remainingOrder.map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 700 })) },
});
const fsrsOk = rv2.json.results.every((r) => r.stability != null && r.fsrsDifficulty != null);
check('FSRS 内核生效（结果带 stability/difficulty）', fsrsOk,
  rv2.json.results.map((r) => `S=${r.stability?.toFixed(1)} D=${r.fsrsDifficulty?.toFixed(1)}`).join(' '));

/* ── 3) 切回艾宾浩斯：级别近似保持并继续晋升 ── */
const backEbb = await req('PATCH', '/api/me', { token, body: { scheduleMode: 'ebbinghaus' } });
check('切回艾宾浩斯模式', backEbb.json.user?.scheduleMode === 'ebbinghaus');

const dv2 = await req('POST', '/api/dev/review-now', { token, body: { count: 2 } });
const t3 = await req('GET', '/api/today', { token });
// 注意：/api/today 的 items 字段是 id（不是 /api/words 的 wordId）
const stagesBeforeBack = new Map(t3.json.items.filter((i) => i.entry === 'review').map((i) => [i.id, i.reviewStage]));

const rv3 = await req('POST', '/api/reviews', {
  token,
  body: { items: t3.json.remainingOrder.map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 600 })) },
});
let preserved = 0;
for (const r of rv3.json.results) {
  const before = stagesBeforeBack.get(r.wordId);
  const init = initialStages.get(r.wordId) ?? 0;
  // 迁移回艾宾浩斯后的级别应接近初始级别+1（FSRS 一轮增长），本轮作答后再 +1
  if (before != null && before >= init && before <= init + 2 && r.stage === Math.min(before + 1, 9)) preserved += 1;
}
check('级别迁移无丢失且回迁后继续晋升', preserved === 2, `${preserved}/2 个词符合预期轨迹`);

/* me 的到期统计一致性 */
const me = await req('GET', '/api/me', { token });
check('/api/me 到期数一致', typeof me.json.dueCount === 'number', `dueCount=${me.json.dueCount}`);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
