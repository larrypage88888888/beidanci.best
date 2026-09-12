#!/usr/bin/env node
/**
 * 艾宾浩斯复习闭环回归测试：
 *   学新词 → 队列清空（全部排到未来）→ 把若干词的 due_at 回拨到过去
 *   → 它们必须重新出现在今日队列（快闪轮）→ 再答「记得」→ 级别晋升。
 *
 * 用法：node scripts/e2e-review-loop.mjs [origin]   默认走 Vite 代理 5173
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const email = `review-loop-${Date.now()}@test.com`;
const password = 'review-pass-12345';

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
  // wrangler 热重载会瞬断在途连接：自动重试 3 次
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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

/** 本地 D1 执行 SQL（wrangler --local） */
function d1(sql) {
  const out = execSync(`npx wrangler d1 execute wordflow-db --local --json --command "${sql}"`, {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out);
}

console.log(`\n🔁 艾宾浩斯复习闭环测试 · 目标 ${BASE}\n`);

/* ---------- 准备：注册 + 摸底 ---------- */
const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '复习测试员' } });
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

/* ---------- 第一轮：学完全部新词 ---------- */
const t1 = await req('GET', '/api/today', { token });
const firstOrder = t1.json.remainingOrder;
check('今日队列有新词', firstOrder.length > 0, `${firstOrder.length} 题`);

/** wordId → 权威 stage */
const stageMap = new Map();
for (let i = 0; i < firstOrder.length; i += 5) {
  const chunk = firstOrder.slice(i, i + 5).map((wordId, k) => ({
    wordId,
    rating: k % 3 === 2 ? 'fuzzy' : 'remembered',
    latencyMs: 1000,
  }));
  const rv = await req('POST', '/api/reviews', { token, body: { items: chunk } });
  for (const r of rv.json.results) stageMap.set(r.wordId, r.stage);
}
check('第一轮作答完成', stageMap.size === firstOrder.length, `覆盖 ${stageMap.size} 词`);

/* ---------- 关键断言 1：刚学完立即拉取，不应有题（都排在未来） ---------- */
const t2 = await req('GET', '/api/today', { token });
check('刚学完队列为空（到期时间都在未来）', t2.json.remainingOrder.length === 0,
  `remaining=${t2.json.remainingOrder.length}`);

/* ---------- 关键断言 2：回拨 due_at 后，词必须回来（快闪轮） ---------- */
const me = await req('GET', '/api/me', { token });
const userId = me.json.user.id;
const revisitIds = [...stageMap.keys()].slice(0, 3);
const pastIso = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
const idList = revisitIds.map((id) => `'${id}'`).join(',');
d1(
  `UPDATE user_word_states SET due_at = '${pastIso}' WHERE user_id = '${userId}' AND word_id IN (${idList});`,
);
console.log(`  ⏩ 已把 ${revisitIds.join('/')} 的 due_at 回拨到过去`);

const t3 = await req('GET', '/api/today', { token });
const cameBack = t3.json.remainingOrder;
const allBack = revisitIds.every((id) => cameBack.includes(id));
check('到期词重新进入队列（艾宾浩斯快闪）', cameBack.length >= 3 && allBack,
  `回来 ${cameBack.length} 题，目标词全部命中=${allBack}`);

/* ---------- 关键断言 3：快闪轮答「记得」→ 级别晋升 +1 ---------- */
const round2 = cameBack.map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 800 }));
const rv2 = await req('POST', '/api/reviews', { token, body: { items: round2 } });
let promoted = 0;
for (const r of rv2.json.results) {
  const prev = stageMap.get(r.wordId) ?? 0;
  if (r.stage === Math.min(prev + 1, 9)) promoted += 1;
  stageMap.set(r.wordId, r.stage);
}
check('快闪轮「记得」→ 级别晋升', promoted === cameBack.length, `${promoted}/${cameBack.length} 个词升级`);

/* ---------- 收尾：再拉一次应为空 ---------- */
const t4 = await req('GET', '/api/today', { token });
check('晋升后再次清空（下一节点在未来）', t4.json.remainingOrder.length === 0);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
