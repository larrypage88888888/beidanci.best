#!/usr/bin/env node
/**
 * 一键清空记录 E2E：
 * 注册 → 摸底 → 学词/对战产出数据 → POST /api/me/reset →
 * 验证：学习状态清空（今日队列回到全新词）、统计/连击清零、图鉴/积分清零、段位清零、需重做摸底。
 * 用法：node scripts/e2e-reset.mjs [origin]
 */
const BASE = process.argv[2] ?? 'http://localhost:8799';
let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` —— ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}
async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function placement(token) {
  let p = await req('POST', '/api/placement/start', { token });
  let result = null, steps = 0;
  while (!result && steps < 30) {
    const a = await req('POST', '/api/placement/answer', {
      token,
      body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct: steps % 4 !== 0 },
    });
    if (a.json?.done) result = a.json.result;
    else if (a.json?.sessionToken) p.json = a.json;
    else break;
    steps += 1;
  }
  return result?.level;
}

console.log('🧪 一键清空记录 E2E');
const reg = await req('POST', '/api/auth/register', { body: { email: `reset-${Date.now()}@t.com`, password: 'e2e-pass-12345', nickname: '清空测试' } });
const token = reg.json?.token;
check('注册成功', (reg.status === 200 || reg.status === 201) && !!token, `status=${reg.status}`);
await placement(token);
await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 3 } });

// 产出学习数据：学 3 个新词（remembered，触发统计/连击/streak）
const t1 = await req('GET', '/api/today', { token });
const fresh = (t1.json?.items ?? []).filter((i) => i.entry === 'new');
check('学前：今日队列有新词', fresh.length === 3, `newCount=${t1.json?.newCount}`);
await req('POST', '/api/reviews', { token, body: { items: fresh.map((i) => ({ wordId: i.id, rating: 'remembered' })), maxCombo: 3 } });
const meBefore = await req('GET', '/api/me', { token });
check('学后：streak ≥ 1', (meBefore.json?.streak ?? 0) >= 1, `streak=${meBefore.json?.streak}`);
const todayStats = await req('GET', '/api/today', { token });
check('学后：今日统计 totalCount ≥ 3', (todayStats.json?.stats?.totalCount ?? 0) >= 3, `totalCount=${todayStats.json?.stats?.totalCount}`);
// 先用 dev 工具把段位顶上去解锁 cet6，验证 reset 会回收解锁状态
await req('POST', '/api/dev/rank-boost', { token, body: { tier: 3 } });
const unlockBefore = await req('PATCH', '/api/me', { token, body: { goalBookId: 'cet6' } });
check('清空前：cet6 已解锁可切换', unlockBefore.status === 200, `status=${unlockBefore.status}`);

// 一键清空
const reset = await req('POST', '/api/me/reset', { token });
check('POST /api/me/reset 成功', reset.status === 200 && reset.json?.ok === true);
check('重置后 placementDone=false（需重做摸底）', reset.json?.user?.placementDone === false);
check('重置后偏好保留（每日新词数=3）', reset.json?.user?.dailyNewLimit === 3);

// 验证数据全部清空
const meAfter = await req('GET', '/api/me', { token });
check('清空后 streak=0', meAfter.json?.streak === 0, `streak=${meAfter.json?.streak}`);
check('清空后 points=0', (meAfter.json?.points ?? -1) === 0, `points=${meAfter.json?.points}`);
check('清空后 cardsCount=0', (meAfter.json?.cardsCount ?? -1) === 0, `cards=${meAfter.json?.cardsCount}`);
check('清空后 reviveCards=0', (meAfter.json?.reviveCards ?? -1) === 0, `revive=${meAfter.json?.reviveCards}`);
// 段位由水平估算动态计算（重新摸底后按新水平重算）；持久化的赛季/历史最高记录已删除 → 高阶词书重新上锁
await req('PATCH', '/api/me', { token, body: { goalBookId: 'cet4' } }); // 先切回默认词书
const lockAfter = await req('PATCH', '/api/me', { token, body: { goalBookId: 'cet6' } });
check('清空后：cet6 重新上锁（历史最高段位已清）', lockAfter.status === 403, `status=${lockAfter.status}`);

// 今日队列回到全新词：无复习词、计划重建
const t2 = await req('GET', '/api/today', { token });
check('清空后 今日队列重建：newCount=3', t2.json?.newCount === 3, `newCount=${t2.json?.newCount}`);
check('清空后 无复习词（reviewCount=0）', t2.json?.reviewCount === 0, `reviewCount=${t2.json?.reviewCount}`);
const ws = await req('GET', '/api/words?filter=all', { token });
check('清空后 词库为空（已学 0 词）', (ws.json?.total ?? -1) === 0, `total=${ws.json?.total}`);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败 ${failed === 0 ? '🎉' : ''}`);
process.exit(failed === 0 ? 0 : 1);
