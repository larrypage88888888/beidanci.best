#!/usr/bin/env node
/**
 * 新词首字母分布验证：连续注册 5 个新用户，各自拉取今日新词，
 * 统计首字母分布，确认修复后不再是 a/b 打头扎堆。
 * 用法：node scripts/check-new-word-dist.mjs [origin]
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
  let result = null;
  let steps = 0;
  while (!result && steps < 30) {
    const ans = await req('POST', '/api/placement/answer', {
      token,
      body: { sessionToken: p.json.sessionToken, wordId: p.json.question.wordId, correct: steps % 4 !== 0 },
    });
    if (ans.json?.done) result = ans.json.result;
    else if (ans.json?.sessionToken) p.json = ans.json;
    else break;
    steps += 1;
  }
  return result?.level;
}

const letterStats = {};
const samples = [];
for (let i = 0; i < 5; i++) {
  const reg = await req('POST', '/api/auth/register', {
    body: { email: `dist-${Date.now()}-${i}@t.com`, password: 'e2e-pass-12345', nickname: `分布${i}` },
  });
  const token = reg.json?.token;
  const level = await placement(token);
  const t = await req('GET', '/api/today', { token });
  const news = (t.json?.items ?? []).filter((x) => x.entry === 'new').map((x) => x.text);
  const initials = news.map((w) => w[0]?.toLowerCase() ?? '?');
  for (const ch of initials) letterStats[ch] = (letterStats[ch] ?? 0) + 1;
  samples.push({ level: level?.toFixed?.(1) ?? level, words: news.slice(0, 8).join(','), initials: initials.join('') });
  console.log(`用户${i + 1} level=${level?.toFixed?.(1) ?? level}`);
  console.log(`  新词: ${news.slice(0, 8).join(' / ')}${news.length > 8 ? ' …' : ''}`);
  console.log(`  首字母: ${initials.join(' ')}`);
}

console.log('\n首字母分布汇总:');
const sorted = Object.entries(letterStats).sort((a, b) => b[1] - a[1]);
for (const [ch, n] of sorted) console.log(`  ${ch}: ${n}`);
const total = Object.values(letterStats).reduce((a, b) => a + b, 0);
const uniqueLetters = Object.keys(letterStats).length;
console.log(`\n共 ${total} 个新词 · 覆盖 ${uniqueLetters} 个不同首字母`);
const ok = uniqueLetters >= 6; // 随机分布下 5 个用户 × 10 词，首字母应明显分散
console.log(ok ? '✅ 首字母分布分散，不再 a 打头扎堆' : '⚠️ 首字母仍偏集中');
process.exit(ok ? 0 : 1);
