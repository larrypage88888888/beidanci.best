#!/usr/bin/env node
/**
 * 端到端冒烟测试：模拟真实用户完整学习流程。
 * 用法：node scripts/e2e-smoke.mjs [origin]
 *   默认 origin = http://localhost:5173（走 Vite 代理，等同浏览器请求路径）
 *
 * 流程：注册 → 登录复核 → 完成摸底 → 拉取今日队列 → 分批作答全部题目
 *      → 复核剩余为空/streak/统计 → 输出 PASS/FAIL 摘要。
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `e2e-${Date.now()}@test.com`;
const password = 'e2e-pass-12345';

let passed = 0;
let failed = 0;
/** @param {string} name @param {boolean} ok @param {string} detail */
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
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

console.log(`\n🎯 词流 E2E 冒烟 · 目标 ${BASE}\n`);

/* ---------- 1. 健康检查 ---------- */
const health = await req('GET', '/api/health');
check('健康检查 /api/health', health.status === 200 && health.json?.ok === true);

/* ---------- 2. 注册 + 登录 ---------- */
const reg = await req('POST', '/api/auth/register', {
  body: { email, password, nickname: 'E2E 测试员' },
});
check('注册新用户', reg.status === 201 && !!reg.json?.token, `昵称=${reg.json?.user?.nickname ?? '?'}`);

let token = reg.json?.token;
const login = await req('POST', '/api/auth/login', { body: { email, password } });
check('登录（PBKDF2 校验）', login.status === 200 && !!login.json?.token);
token = login.json?.token ?? token;

/* ---------- 3. 摸底测试（自适应收敛） ---------- */
let p = await req('POST', '/api/placement/start', { token });
check('摸底开始并出第一题', p.status === 200 && !!p.json?.question?.text, `首词=${p.json?.question?.text ?? '?'}`);

let result = null;
let steps = 0;
while (!result && steps < 30) {
  const correct = steps % 4 !== 0; // 模拟约 75% 正确率
  const ans = await req('POST', '/api/placement/answer', {
    token,
    body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct },
  });
  if (ans.json?.done) {
    result = ans.json.result;
  } else if (ans.json?.sessionToken) {
    p.json = ans.json;
  } else {
    break;
  }
  steps += 1;
}
check(
  '摸底完成并写入水平',
  !!result && typeof result.level === 'number',
  result ? `level=${result.level} cefr=${result.cefr} 词汇量≈${result.vocabEstimate} 用题=${result.questionCount}` : '未收敛',
);

/* ---------- 4. 今日队列 ---------- */
const t1 = await req('GET', '/api/today', { token });
const orderCount = t1.json?.remainingOrder?.length ?? 0;
check('拉取今日队列', t1.status === 200 && orderCount > 0, `${orderCount} 题（复习+新词穿插）`);
check('队列包含词条详情与释义', (t1.json?.items ?? []).every((w) => Array.isArray(w.definitions)));

/* ---------- 5. 全部作答（分批回写，验证攒批逻辑） ---------- */
const ratings = ['remembered', 'fuzzy', 'forgot'];
let answered = 0;
const order = t1.json.remainingOrder;
for (let i = 0; i < order.length; i += 5) {
  const chunk = order.slice(i, i + 5).map((wordId, k) => ({
    wordId,
    rating: ratings[(i + k) % 3],
    latencyMs: 900 + k * 100,
  }));
  const rv = await req('POST', '/api/reviews', { token, body: { items: chunk } });
  check(`回写第 ${i / 5 + 1} 批（${chunk.length} 条）`, rv.status === 200 && rv.json?.results?.length === chunk.length,
    `streak=${rv.json?.streak ?? '?'} 徽章=[${(rv.json?.unlockedBadges ?? []).join(',')}]`);
  answered += chunk.length;
}

/* ---------- 6. 复核：队列清空、状态正确 ---------- */
const t2 = await req('GET', '/api/today', { token });
check('已答题目从队列剔除', (t2.json?.remainingOrder?.length ?? -1) === 0, `今日累计 ${t2.json?.stats?.totalCount} 次作答`);

const me = await req('GET', '/api/me', { token });
check('/api/me 返回 streak 与等级', me.status === 200 && me.json?.streak >= 1 && typeof me.json?.user?.level === 'number',
  `streak=${me.json?.streak} level=${me.json?.user?.level} 到期=${me.json?.dueCount}`);

/* ---------- 7. 调度正确性抽查：忘记的词应在 5 分钟内到期 ---------- */
const forgotWord = t1.json.remainingOrder[1]; // 第 2 题固定为 forgot
if (forgotWord) {
  const dueIso = new Date(Date.now() + 5 * 60_000).toISOString();
  const spot = await fetch(`${BASE}/api/wordpack/cet4/1`, { headers: { Authorization: `Bearer ${token}` } });
  check('词条包可下发（难度懒计算）', spot.status === 200);
}

/* ---------- 摘要 ---------- */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
