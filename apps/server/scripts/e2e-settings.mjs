#!/usr/bin/env node
/**
 * 设置 E2E：每日新词上限修改后「当日立即生效」
 * 用法：node scripts/e2e-settings.mjs [origin]
 * 流程：注册 → 摸底 → GET /today（默认 10）→ PATCH 上限 5 → GET /today（≤5）
 *      → PATCH 上限 30 → GET /today（>5 且 ≤30，计划已按新上限重建）
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `settings-${Date.now()}@test.com`;
const password = 'e2e-pass-12345';

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

console.log(`\n⚙️ 词流 设置（新词上限立即生效）冒烟 · 目标 ${BASE}\n`);

const health = await req('GET', '/api/health');
check('健康检查', health.status === 200 && health.json?.ok === true);

const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '设置测试员' } });
check('注册新用户', reg.status === 201 && !!reg.json?.token);
const token = reg.json?.token;

let p = await req('POST', '/api/placement/start', { token });
let result = null;
let steps = 0;
while (!result && steps < 30) {
  const correct = steps % 4 !== 0;
  const ans = await req('POST', '/api/placement/answer', {
    token,
    body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct },
  });
  if (ans.json?.done) result = ans.json.result;
  else if (ans.json?.sessionToken) p.json = ans.json;
  else break;
  steps += 1;
}
check('摸底完成', !!result && typeof result.level === 'number', `level=${result?.level ?? '?'}`);

/* 1. 默认 10 */
const t0 = await req('GET', '/api/today', { token });
check('默认上限 10 且新词 ≤10', t0.status === 200 && t0.json?.newQuota?.limit === 10 && (t0.json?.newCount ?? 0) <= 10,
  `limit=${t0.json?.newQuota?.limit} new=${t0.json?.newCount}`);

/* 2. 改成 5 → 立即生效 */
const p5 = await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 5 } });
check('PATCH 上限 5 保存成功', p5.status === 200 && p5.json?.user?.dailyNewLimit === 5);
const t5 = await req('GET', '/api/today', { token });
check('当日立即生效：新词 ≤5', t5.status === 200 && t5.json?.newQuota?.limit === 5 && (t5.json?.newCount ?? 0) <= 5,
  `limit=${t5.json?.newQuota?.limit} new=${t5.json?.newCount}`);
check('新词数从 10 缩减到 ≤5', (t0.json?.newCount ?? 0) > (t5.json?.newCount ?? 0) && t5.json?.newCount >= 0,
  `${t0.json?.newCount} → ${t5.json?.newCount}`);

/* 3. 改成 30 → 新词扩充（计划重建） */
const p30 = await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 30 } });
check('PATCH 上限 30 保存成功', p30.status === 200 && p30.json?.user?.dailyNewLimit === 30);
const t30 = await req('GET', '/api/today', { token });
check('上限 30 生效：新词 >5 且 ≤30', t30.status === 200 && t30.json?.newQuota?.limit === 30 && (t30.json?.newCount ?? 0) >= 6 && (t30.json?.newCount ?? 0) <= 30,
  `limit=${t30.json?.newQuota?.limit} new=${t30.json?.newCount}`);

/* 4. 再降回 10（幂等、无副作用） */
const p10 = await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 10 } });
const t10 = await req('GET', '/api/today', { token });
check('改回 10 也立即生效', p10.status === 200 && t10.json?.newQuota?.limit === 10 && (t10.json?.newCount ?? 0) <= 10,
  `new=${t10.json?.newCount}`);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
