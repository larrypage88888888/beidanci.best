#!/usr/bin/env node
/**
 * 卡牌对战 PVE E2E：词灵 BOSS 战（用户需求）
 * 用法：node scripts/e2e-battle.mjs [origin]
 * 流程：注册 → 摸底 → BOSS 列表 → 开战 → 全对 WIN（积分/限定卡/抽卡加成/每日记录）
 *      → 同 BOSS 二次开战 409 → 再战另一 BOSS 全错 LOSE（安慰奖）→ /api/me 字段。
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `battle-${Date.now()}@test.com`;
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

console.log(`\n⚔️ 词流 卡牌对战 PVE 冒烟 · 目标 ${BASE}\n`);

/* 1. 健康 + 注册 + 摸底 */
const health = await req('GET', '/api/health');
check('健康检查', health.status === 200 && health.json?.ok === true);

const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '对战测试员' } });
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

/* 2. BOSS 列表：3 个、今日未打 */
const bosses0 = await req('GET', '/api/battle/bosses', { token });
const bs = bosses0.json?.bosses ?? [];
check('GET /api/battle/bosses 返回 3 个 BOSS', bosses0.status === 200 && bs.length === 3 && bosses0.json?.questionCount === 10,
  `${bs.length} 个 · 每题 ${bosses0.json?.questionCount}`);
check('初始今日全未挑战', bs.every((b) => !b.playedToday && !b.wonToday));
check('BOSS 配置合法（血量/奖励/稀有度）', bs.every((b) => b.hp >= 10 && b.rewardPoints >= 30 && ['SR', 'SSR', 'UR'].includes(b.rewardRarity)));

/* 3. 挑战第一个 BOSS：全对 → WIN */
const b1 = bs[0];
const st = await req('POST', '/api/battle/start', { token, body: { bossId: b1.id } });
check('开战成功（返回 10 题与血量）',
  st.status === 200 && st.json?.battleId && st.json?.total === 10 && st.json?.question?.prompt,
  `BOSS=${st.json?.boss?.name} 血=${st.json?.bossHp}/${st.json?.boss?.hp} 首题=${st.json?.question?.kind}`);

let battleId = st.json?.battleId;
let done = null;
let answers = 0;
let lastAnswer = null;
for (let i = 0; i < 10 && !done; i++) {
  const q = done ? null : i === 0 ? st.json?.question : lastAnswer?.next;
  if (!q) break;
  let body;
  if (q.kind === 'spell') body = { battleId, typed: q.wordText };
  else body = { battleId, picked: q.answerKey }; // 服务端判定：直接提交正确答案
  const a = await req('POST', '/api/battle/answer', { token, body });
  lastAnswer = a.json;
  answers += 1;
  if (a.json?.finished) {
    done = a.json;
    break;
  }
  if (a.status !== 200 || !a.json?.next) break;
}
check('全对连击击破 BOSS（12 血 → 约 7 题内）',
  answers >= 6 && answers <= 10,
  `第 ${answers} 题击破`);
check('自动结算为 WIN',
  !!done && done.finished && done.result === 'win' && done.win === true,
  `result=${done?.result} 对=${done?.correctCount}/${done?.total} 剩余❤️=${done?.playerHp}`);
check('胜利奖励：积分 + 限定卡掉落',
  done?.reward?.points >= b1.rewardPoints && !!done?.reward?.card && !done?.reward?.card?.duplicate,
  `积分+${done?.reward?.points} 卡=${done?.reward?.card?.rarity}:${done?.reward?.card?.wordId}`);
check('BOSS 限定卡稀有度 = 配置值', done?.reward?.card?.rarity === b1.rewardRarity, `rarity=${done?.reward?.card?.rarity}`);

/* 4. 同 BOSS 二次开战 → 409；每日记录 */
const again = await req('POST', '/api/battle/start', { token, body: { bossId: b1.id } });
check('同 BOSS 当天不能再挑战（409）', again.status === 409 && again.json?.error === 'battle_done');

const bosses1 = await req('GET', '/api/battle/bosses', { token });
const b1st = bosses1.json?.bosses?.find((b) => b.id === b1.id);
check('BOSS 列表今日已击败状态', b1st?.playedToday === true && b1st?.wonToday === true);

/* 5. 抽卡资格加成：battle_wins 计入（作答+胜利 → eligible 提升） */
const me = await req('GET', '/api/me', { token });
check('/api/me 返回对战加成后的抽卡资格', me.status === 200 && me.json?.cardDraw?.eligible >= 1,
  `eligible=${me.json?.cardDraw?.eligible}（10 题作答+1 BOSS 胜利）`);

/* 6. 另一个 BOSS 全错 → LOSE（安慰奖） */
const b2 = bs[1];
const st2 = await req('POST', '/api/battle/start', { token, body: { bossId: b2.id } });
check('第二个 BOSS 可开战', st2.status === 200, `boss=${b2.name}`);
let done2 = null;
battleId = st2.json?.battleId;
let last2 = null;
for (let i = 0; i < 10 && !done2; i++) {
  const q = i === 0 ? st2.json?.question : last2?.next;
  if (!q) break;
  const a = await req('POST', '/api/battle/answer', { token, body: { battleId, picked: 'Z', typed: '__wrong__' } });
  last2 = a.json;
  if (a.json?.finished) {
    done2 = a.json;
    break;
  }
}
check('全错 → LOSE（5 次反击后落败）', !!done2 && done2.result === 'lose' && done2.playerHp === 0,
  `result=${done2?.result} ❤️=${done2?.playerHp} 对=${done2?.correctCount}`);
check('失败给参与奖（5 词力，无卡）', done2?.reward?.points === 5 && done2?.reward?.card === null);

/* 摘要 */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
