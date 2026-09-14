#!/usr/bin/env node
/**
 * P0 趣味化 E2E 冒烟：连击纪录 / 词苗 / 词卡抽卡（设计文档 §十）。
 * 用法：node scripts/e2e-gamification.mjs [origin]
 * 流程：注册 → 摸底 → 今日队列 → 回写作答（含 maxCombo）→ 校验词苗/抽卡资格
 *      → 抽卡 → 图鉴 → /api/me 趣味化字段。
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `game-${Date.now()}@test.com`;
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

console.log(`\n🎮 词流 P0 趣味化冒烟 · 目标 ${BASE}\n`);

/* 1. 健康检查 */
const health = await req('GET', '/api/health');
check('健康检查 /api/health', health.status === 200 && health.json?.ok === true);

/* 2. 注册 */
const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '趣味化测试员' } });
check('注册新用户', reg.status === 201 && !!reg.json?.token);
let token = reg.json?.token;

/* 3. 摸底（复制 e2e-smoke 流程） */
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

/* 4. 今日队列 + 作答（含 maxCombo，≥15 次以解锁抽卡资格） */
const t1 = await req('GET', '/api/today', { token });
const order = t1.json?.remainingOrder ?? [];
check('拉取今日队列', t1.status === 200 && order.length > 0, `${order.length} 题`);

const MAX_COMBO = 12; // ≥10 → 额外 +1 抽卡
let totalCount = t1.json?.stats?.totalCount ?? 0;
let pet = null;
let cardDraw = null;
let reviveCards = 0;

async function submitChunk(n) {
  const chunk = [];
  for (let i = 0; i < n; i++) {
    const w = order[i % order.length];
    if (!w) break;
    chunk.push({ wordId: w, rating: i % 5 === 3 ? 'fuzzy' : 'remembered', latencyMs: 600 });
  }
  if (chunk.length === 0) return;
  const rv = await req('POST', '/api/reviews', { token, body: { items: chunk, maxCombo: MAX_COMBO } });
  totalCount += chunk.length;
  pet = rv.json?.pet ?? pet;
  cardDraw = rv.json?.cardDraw ?? cardDraw;
  reviveCards = rv.json?.reviveCards ?? reviveCards;
  return rv;
}

// 首次全量作答
for (let i = 0; i < order.length; i += 5) await submitChunk(5);
// 不足 15 次则继续凑
let guard = 0;
while ((totalCount < 15) && guard < 6) {
  await submitChunk(5);
  guard += 1;
}

check('回写响应含词苗信息（新建即发放复活卡）', !!pet && pet.treeAgeDays === 1 && pet.stageIdx === 0 && reviveCards === 1,
  `树龄=${pet?.treeAgeDays ?? '?'} 阶段=${pet?.stageLabel ?? '?'} 复活卡=${reviveCards}`);
check('回写响应含抽卡资格', !!cardDraw && typeof cardDraw.eligible === 'number' && typeof cardDraw.remaining === 'number',
  `作答=${totalCount} eligible=${cardDraw?.eligible} remaining=${cardDraw?.remaining}`);
check('连击≥10 且作答≥15 → 抽卡资格=2', cardDraw?.eligible === 2,
  `eligible=${cardDraw?.eligible}（期望 2 = 作答1 + 连击1）`);

/* 5. 抽卡：抽到剩余为 0 或 409 */
let remaining = cardDraw?.remaining ?? 0;
let drawCount = 0;
let card = null;
let got409 = false;
while (remaining > 0 && drawCount < 5) {
  const d = await req('POST', '/api/cards/draw', { token, body: {} });
  if (d.status === 200 && d.json?.card) {
    card = d.json.card;
    remaining = d.json.remaining;
    drawCount += 1;
  } else if (d.status === 409) {
    got409 = true;
    break;
  } else {
    check(`抽卡第 ${drawCount + 1} 次`, false, `status=${d.status} ${JSON.stringify(d.json)}`);
    break;
  }
}
check('成功抽到词卡（稀有度合法）', drawCount >= 1 && ['SR', 'SSR', 'UR'].includes(card?.rarity),
  `抽了 ${drawCount} 张，首张=${card?.rarity ?? '?'} ${card?.duplicate ? `重复→+${card?.pointsGained}词力` : ''} remaining=${remaining}`);
check('剩余次数正确递减或已耗尽', remaining === 0 || got409, `remaining=${remaining} ${got409 ? '(409 no_draws)' : ''}`);

/* 6. 图鉴 */
const col = await req('GET', '/api/cards/collection', { token });
check('图鉴返回收藏与积分', col.status === 200 && col.json?.counts?.total >= drawCount - (card?.duplicate ? 1 : 0) && typeof col.json?.points === 'number',
  `收藏=${col.json?.counts?.total} 词力=${col.json?.points} SR=${col.json?.counts?.SR} SSR=${col.json?.counts?.SSR} UR=${col.json?.counts?.UR}`);
check('图鉴每张卡带释义', (col.json?.items ?? []).every((it) => typeof it.text === 'string' && Array.isArray(it.definitions)));

/* 7. /api/me 趣味化字段 */
const me = await req('GET', '/api/me', { token });
check('/api/me 含词苗/积分/图鉴/复活卡/抽卡资格',
  me.status === 200 && !!me.json?.pet && typeof me.json?.points === 'number' && typeof me.json?.cardsCount === 'number' &&
    typeof me.json?.reviveCards === 'number' && !!me.json?.cardDraw,
  `词苗=${me.json?.pet?.stageLabel ?? '?'} 词力=${me.json?.points} 图鉴=${me.json?.cardsCount} 复活卡=${me.json?.reviveCards}`);

/* 摘要 */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
