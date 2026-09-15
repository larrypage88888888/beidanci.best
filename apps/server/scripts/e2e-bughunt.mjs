#!/usr/bin/env node
/**
 * 深度 Bug Hunt E2E（本地专用，依赖 DEV_MODE 的 /api/dev/review-now 加速快闪复习）
 * 用法：node scripts/e2e-bughunt.mjs [origin]
 * 覆盖：艾宾浩斯快闪复习→毕业循环 / forgot 降级 / fuzzy 停留 / 词苗同日不重复计龄 /
 *       FSRS 切换与回迁 / 边界输入（越界/空/未认证）/ 同批重复词提交（新词计数防重）
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `hunt-${Date.now()}@test.com`;
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

console.log(`\n🔍 词流 深度 Bug Hunt · 目标 ${BASE}\n`);

const health = await req('GET', '/api/health');
check('健康检查', health.status === 200 && health.json?.ok === true);

const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '深测员' } });
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

// dev 工具可用性探测
const devProbe = await req('POST', '/api/dev/review-now', { token, body: { count: 1 } });
const hasDev = devProbe.status === 200 || devProbe.status === 409; // 409=没有学习记录，说明工具开放
console.log(hasDev ? '  ✅ dev 快闪工具可用（深度复习测试开启）' : '  ⏭️ dev 快闪工具不可用（生产环境，跳过深度复习测试）');
if (!hasDev) passed += 1; // 跳过视为通过（生产环境预期行为）

/* A. 艾宾浩斯快闪复习 → 毕业循环 */
const t0 = await req('GET', '/api/today', { token });
const newWords = (t0.json?.items ?? []).filter((i) => i.entry === 'new').slice(0, 3);
const freshIds = newWords.map((w) => w.id);
check('今日队列取到 3 个新词', freshIds.length === 3, freshIds.join(','));

const r1 = await req('POST', '/api/reviews', {
  token,
  body: { items: freshIds.map((w) => ({ wordId: w, rating: 'remembered', latencyMs: 1000 })), maxCombo: 3 },
});
const s1 = r1.json?.results?.[0];
check('首次作答 → stage1（30分钟），未毕业', r1.status === 200 && s1?.stage === 1 && s1?.graduated === false && s1?.intervalMinutes === 30,
  `stage=${s1?.stage} 间隔=${s1?.intervalMinutes}min`);
check('作答后 dueAt 在未来（快闪排期）', s1?.dueAt && s1.dueAt > new Date(Date.now() - 1000).toISOString(), `due=${s1?.dueAt}`);

// 快闪复习循环：stage 2 → 9 毕业
let stage = 1;
let graduatedDone = null;
for (let target = 2; target <= 9 && hasDev; target++) {
  await req('POST', '/api/dev/review-now', { token, body: { count: 3 } });
  const t = await req('GET', '/api/today', { token });
  const back = freshIds.filter((id) => (t.json?.items ?? []).some((i) => i.id === id));
  if (back.length === 0) { console.error(`  ⚠️ 第 ${target} 轮拉回失败，词没回来`); break; }
  const rv = await req('POST', '/api/reviews', {
    token,
    body: { items: back.map((id) => ({ wordId: id, rating: 'remembered', latencyMs: 400 })), maxCombo: target },
  });
  const s = rv.json?.results?.[0];
  stage = s?.stage ?? stage;
  if (s?.graduated) { graduatedDone = s; break; }
}
check('复习循环推进到毕业（stage9）', !hasDev || graduatedDone?.graduated === true,
  hasDev ? `stage=${graduatedDone?.stage} reps=${graduatedDone?.reps}` : '跳过（无 dev）');
check('毕业词不再排期（dueAt 为 null）', !hasDev || graduatedDone?.dueAt === null,
  hasDev ? '' : '跳过（无 dev）');

// 毕业词排除：拉回工具不再返回毕业词，队列也不含
{
  const t2 = await req('GET', '/api/today', { token });
  const leaked = freshIds.filter((id) => (t2.json?.items ?? []).some((i) => i.id === id));
  check('毕业词不再进入今日队列（复习/新词均不含）', !hasDev || leaked.length === 0,
    hasDev ? (leaked.length > 0 ? `泄漏:${leaked.join(',')}` : '全部排除 ✓') : '跳过（无 dev）');
}

/* B. forgot 降级 / fuzzy 停留 / 恢复 */
const bWord = freshIds[0] ?? newWords[0]?.id;
if (hasDev && bWord) {
  await req('POST', '/api/dev/review-now', { token, body: { count: 3 } });
  const f1 = await req('POST', '/api/reviews', { token, body: { items: [{ wordId: bWord, rating: 'forgot' }] } });
  const sf = f1.json?.results?.[0];
  check('forgot → 降到 stage0（5分钟快闪）', f1.status === 200 && sf?.stage === 0 && sf?.intervalMinutes === 5, `stage=${sf?.stage} 间隔=${sf?.intervalMinutes}min`);

  await req('POST', '/api/dev/review-now', { token, body: { count: 3 } });
  const fz = await req('POST', '/api/reviews', { token, body: { items: [{ wordId: bWord, rating: 'fuzzy' }] } });
  check('fuzzy → 停留本级（stage 不变）', fz.json?.results?.[0]?.stage === 0, `stage=${fz.json?.results?.[0]?.stage}`);

  await req('POST', '/api/dev/review-now', { token, body: { count: 3 } });
  const f2 = await req('POST', '/api/reviews', { token, body: { items: [{ wordId: bWord, rating: 'remembered' }] } });
  check('forgot 后 remembered → 恢复晋升 stage1', f2.json?.results?.[0]?.stage === 1, `stage=${f2.json?.results?.[0]?.stage}`);
}

/* C. 词苗：同日多次回写不重复计龄 */
const pet1 = await req('GET', '/api/me', { token });
const ageBefore = pet1.json?.pet?.treeAgeDays;
await req('POST', '/api/reviews', { token, body: { items: freshIds.slice(0, 1).map((w) => ({ wordId: w, rating: 'remembered', latencyMs: 500 })) } });
const pet2 = await req('GET', '/api/me', { token });
check('词苗同日多次回写树龄不重复累计', pet2.json?.pet?.treeAgeDays === ageBefore, `age=${ageBefore} → ${pet2.json?.pet?.treeAgeDays}`);

/* D. FSRS 切换与回迁 */
const toFsrs = await req('PATCH', '/api/me', { token, body: { scheduleMode: 'fsrs' } });
check('切换到 FSRS', toFsrs.status === 200 && toFsrs.json?.user?.scheduleMode === 'fsrs');

const tf = await req('GET', '/api/today', { token });
const fsrsWord = (tf.json?.items ?? []).find((i) => i.entry === 'new')?.id;
if (fsrsWord) {
  const fsv = await req('POST', '/api/reviews', { token, body: { items: [{ wordId: fsrsWord, rating: 'remembered' }] } });
  const sf = fsv.json?.results?.[0];
  check('FSRS 作答 → stability 计算、无 stage、间隔按稳定度', fsv.status === 200 && sf?.stage === null && typeof sf?.stability === 'number' && sf?.stability > 0 && sf?.graduated === false,
    `stability=${sf?.stability?.toFixed(2)} 间隔=${sf?.intervalMinutes}min`);
}
const backToE = await req('PATCH', '/api/me', { token, body: { scheduleMode: 'ebbinghaus' } });
check('切回艾宾浩斯', backToE.status === 200 && backToE.json?.user?.scheduleMode === 'ebbinghaus');

/* E. 边界输入 */
check('PATCH 上限 0 → 400', (await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 0 } })).status === 400);
check('PATCH 上限 101 → 400', (await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 101 } })).status === 400);
check('PATCH 空昵称 → 400', (await req('PATCH', '/api/me', { token, body: { nickname: '' } })).status === 400);
check('reviews 空 items → 400', (await req('POST', '/api/reviews', { token, body: { items: [] } })).status === 400);
check('未认证 /api/today → 401', (await req('GET', '/api/today')).status === 401);
check('未认证 /api/battle/bosses → 401', (await req('GET', '/api/battle/bosses')).status === 401);
check('battle start 缺 bossId → 400', (await req('POST', '/api/battle/start', { token, body: {} })).status === 400);
check('battle answer 非法 rating 之外的输入 → 400', (await req('POST', '/api/battle/answer', { token, body: {} })).status === 400);

/* F. 同批重复词提交：新词计数只 +1（防重复计） */
const tf2 = await req('GET', '/api/today', { token });
const dupWord = (tf2.json?.items ?? []).find((i) => i.entry === 'new')?.id;
if (dupWord) {
  const before = (await req('GET', '/api/today', { token })).json?.stats?.newLearned ?? 0;
  const dupSub = await req('POST', '/api/reviews', {
    token,
    body: { items: [{ wordId: dupWord, rating: 'remembered' }, { wordId: dupWord, rating: 'remembered' }] },
  });
  const after = (await req('GET', '/api/today', { token })).json?.stats?.newLearned ?? 0;
  check('同批重复提交同一词 → 新词计数只 +1（当前应暴露 bug）', dupSub.status === 200 && after - before === 1,
    `newLearned ${before} → ${after}（期望 +1，实际 ${after - before}）`);
}

/* 摘要 */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
