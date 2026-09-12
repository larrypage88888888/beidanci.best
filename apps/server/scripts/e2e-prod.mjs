#!/usr/bin/env node
/**
 * 生产环境冒烟测试：node scripts/e2e-prod.mjs <base-url>
 * 覆盖：健康检查 / 注册登录 / 摸底 / 今日队列 / 作答回写 / 词库 / 静态资产 / 测试工具应关闭
 */
const BASE = process.argv[2] ?? 'https://wordflow-api.larrypage88888888.workers.dev';

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
};

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

console.log(`\n🌐 生产冒烟 · ${BASE}\n`);

/* 健康检查 + 静态资产 */
ok('GET /api/health', (await req('GET', '/api/health')).status === 200);
const indexRes = await fetch(`${BASE}/`);
const html = await indexRes.text();
ok('静态首页 index.html', indexRes.status === 200 && html.includes('<div id="root">'));
const swRes = await fetch(`${BASE}/sw.js`);
ok('Service Worker sw.js', swRes.status === 200);
const manifestRes = await fetch(`${BASE}/manifest.webmanifest`);
const manifestJson = await manifestRes.json().catch(() => null);
ok('PWA manifest', manifestJson?.name != null, manifestJson?.name);

/* 注册登录（固定测试账号：重复运行时自动改为登录） */
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'tester@beidianci.best';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'Test12345678';

let reg = await req('POST', '/api/auth/register', { body: { email: TEST_EMAIL, password: TEST_PASSWORD, nickname: '线上测试员' } });
if (reg.status === 201) {
  ok('注册测试用户', true, TEST_EMAIL);
} else if (reg.status === 409 || /exist|已/.test(reg.json?.message ?? '')) {
  ok('测试用户已存在，改用登录', true);
  reg = { status: 200 };
} else {
  ok('注册测试用户', false, `${reg.status} ${JSON.stringify(reg.json)}`);
}
const token = reg.json?.token;
let authToken;
if (!token) {
  const lg = await req('POST', '/api/auth/login', { body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
  ok('登录测试用户', lg.status === 200 && !!lg.json.token);
  authToken = lg.json.token;
} else {
  authToken = token;
}

/* 摸底 */
let p = await req('POST', '/api/placement/start', { token: authToken });
let used = 1;
for (let i = 0; i < 30; i++) {
  if (p.json.done) break; // 老账号已完成摸底
  const ans = await req('POST', '/api/placement/answer', {
    token: authToken,
    body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct: i % 4 !== 3 },
  });
  used++;
  if (ans.json.done) {
    p.json.result = ans.json.result;
    break;
  }
  p.json = ans.json;
}
ok('摸底收敛（老账号自动跳过）', p.json.done || p.json.result?.level != null,
  p.json.result?.level ? `level=${p.json.result.level} cefr=${p.json.result.cefr}` : '沿用既有水平');

/* 今日队列 + 例句下发 + 作答闭环 */
const t = await req('GET', '/api/today', { token: authToken });
ok('今日队列', t.json.remainingOrder.length > 0, `${t.json.remainingOrder.length} 题（复习${t.json.reviewCount}/新词${t.json.newCount}）`);
const withExample = (t.json.items ?? []).filter((i) => i.example && i.exampleZh).length;
ok('例句+句译随题下发', withExample > 0, `${withExample}/${t.json.items.length} 题带例句`);
const chunk = t.json.remainingOrder.slice(0, 5).map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 900 }));
const rv = await req('POST', '/api/reviews', { token: authToken, body: { items: chunk } });
ok('批动作答回写（含超长耗时字段）', rv.status === 200, `streak=${rv.json.streak}`);

/* 词库 */
const w = await req('GET', '/api/words', { token: authToken });
ok('词库列表', w.json.total >= 5, `已学=${w.json.total}`);

/* 生产环境测试工具必须关闭 */
const dv = await req('POST', '/api/dev/review-now', { token: authToken, body: { count: 1 } });
ok('DEV 工具在生产已禁用', dv.status === 403);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
