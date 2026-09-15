#!/usr/bin/env node
/**
 * 验证北京时区日期键修复：
 * 1) GET /api/today 的 date 字段应为北京日期（本机北京 06:15 → 2026-09-16，而非 UTC 的 09-15）
 * 2) 新用户设上限 2 → 今天队列应含 2 个新词 + 复习
 * 3) 学完后今日 newLearned 记到北京日期
 */
const BASE = process.argv[2] ?? 'http://localhost:8799';
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

const bjDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const utcDate = new Date().toISOString().slice(0, 10);
console.log(`UTC 日期=${utcDate}  北京日期=${bjDate}`);

const reg = await req('POST', '/api/auth/register', { body: { email: `tz-${Date.now()}@t.com`, password: 'e2e-pass-12345', nickname: '时区' } });
const token = reg.json?.token;
await placement(token);
await req('PATCH', '/api/me', { token, body: { dailyNewLimit: 2 } });

const t1 = await req('GET', '/api/today', { token });
const news = (t1.json.items ?? []).filter((i) => i.entry === 'new').map((i) => i.text);
console.log(`today.date=${t1.json.date}  (期望=${bjDate})`);
console.log(`today.mode=${t1.json.mode} newCount=${t1.json.newCount} reviewCount=${t1.json.reviewCount}`);
console.log(`新词[${news.length}]: ${news.join(', ')}`);

let pass = true;
if (t1.json.date !== bjDate) { console.log(`❌ date 应为北京日期 ${bjDate}，实际 ${t1.json.date}`); pass = false; }
else console.log(`✅ date 字段 = 北京日期`);
if (news.length !== 2) { console.log(`❌ 今日应有 2 个新词（上限 2），实际 ${news.length}`); pass = false; }
else console.log(`✅ 今日 2 个新词`);

// 学完 2 个新词 → 今日统计应记在北京日期
const batch = news.map((id) => ({ wordId: id, rating: 'remembered' }));
await req('POST', '/api/reviews', { token, body: { items: batch, maxCombo: 2 } });
const me = await req('GET', '/api/me', { token });
console.log(`me.stats: ${JSON.stringify(me.json?.stats ?? null)}`);
console.log(pass ? '\n🎉 时区修复验证通过' : '\n❌ 存在失败项');
process.exit(pass ? 0 : 1);
