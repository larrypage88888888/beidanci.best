#!/usr/bin/env node
/**
 * 重做今日单词 E2E（修复：完成后无法再次进入）
 * 用法：node scripts/e2e-redo.mjs [origin]
 * 流程：注册 → 摸底 → 学 3 个新词 → GET /today?mode=redo 返回今日已学词（全部标复习）
 *      → 重做提交一条 → 200；且正常队列不再重复给已学新词
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `redo-${Date.now()}@test.com`;
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

console.log(`\n📖 词流 重做今日单词 冒烟 · 目标 ${BASE}\n`);

const health = await req('GET', '/api/health');
check('健康检查', health.status === 200 && health.json?.ok === true);

const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '重做测试员' } });
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

/* 1. 正常队列：学 3 个新词 */
const t0 = await req('GET', '/api/today', { token });
const fresh = (t0.json?.items ?? []).filter((i) => i.entry === 'new').slice(0, 3);
check('今日队列含新词（≥3）', fresh.length >= 3, `new=${fresh.length}`);

const sub = await req('POST', '/api/reviews', {
  token,
  body: { items: fresh.map((w) => ({ wordId: w.id, rating: 'remembered', latencyMs: 3000 })), maxCombo: 3 },
});
check('学习 3 个新词成功', sub.status === 200 && sub.json?.results?.length === 3);

/* 2. 正常队列不再重复已学新词，额度消耗 3 */
const t1 = await req('GET', '/api/today', { token });
check('正常队列新词额度已用 3', t1.json?.newQuota?.used === 3, `used=${t1.json?.newQuota?.used}`);
check('正常队列不含已学的新词', !(t1.json?.items ?? []).some((i) => i.entry === 'new' && fresh.some((f) => f.id === i.id)),
  `newCount=${t1.json?.newCount}`);

/* 3. redo 模式：返回今日已学词，全部标复习，可再次进入做题 */
const tr = await req('GET', '/api/today?mode=redo', { token });
const learned = fresh.map((f) => f.id);
check('redo 队列包含今日学过的词', tr.status === 200 && learned.every((id) => (tr.json?.items ?? []).some((i) => i.id === id)),
  `items=${tr.json?.items?.length}`);
check('redo 队列全部标为复习（无新词）', (tr.json?.items ?? []).length > 0 && (tr.json?.items ?? []).every((i) => i.entry === 'review'),
  `mode=${tr.json?.mode} reviewCount=${tr.json?.reviewCount}`);
check('redo 不消耗新词额度（used 不变）', tr.json?.newQuota?.used === 3, `used=${tr.json?.newQuota?.used}`);

/* 4. 重做作答照常提交 */
const redoWord = (tr.json?.items ?? [])[0];
const redo = await req('POST', '/api/reviews', {
  token,
  body: { items: [{ wordId: redoWord.id, rating: 'remembered', latencyMs: 2000 }], maxCombo: 0 },
});
check('重做作答提交成功', redo.status === 200 && redo.json?.results?.length === 1,
  `result=${redo.json?.results?.[0]?.wordId ?? '?'}`);

/* 5. 未学词的 redo 队列为空（防御） */
const tr2 = await req('GET', '/api/today?mode=redo', { token });
check('redo 幂等可重复拉取', tr2.status === 200 && tr2.json?.items?.length === tr.json?.items?.length);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
