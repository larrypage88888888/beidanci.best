#!/usr/bin/env node
/**
 * 卡牌对战（炉石式词灵对决）E2E
 * 用法：node scripts/e2e-battle.mjs [origin]
 * 流程：注册 → 摸底 → BOSS 列表（英雄 30/35/40）→ 开战（发 5 张手牌）→
 *      全对 WIN（召唤随从伤害/连击/每日记录/限定卡）→ 同 BOSS 409 → 另一 BOSS 全错 LOSE（安慰奖）
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

console.log(`\n⚔️ 词流 炉石式卡牌对战 冒烟 · 目标 ${BASE}\n`);

/* 1. 健康 + 注册 + 摸底 */
const health = await req('GET', '/api/health');
check('健康检查', health.status === 200 && health.json?.ok === true);

const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: '炉石对战员' } });
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

/* 2. BOSS 列表：3 个、英雄血量 30/35/40、今日未打 */
const bosses0 = await req('GET', '/api/battle/bosses', { token });
const bs = bosses0.json?.bosses ?? [];
check('GET /api/battle/bosses 返回 3 个词灵', bosses0.status === 200 && bs.length === 3 && bosses0.json?.questionCount === 10,
  `${bs.length} 个 · 每题 ${bosses0.json?.questionCount}`);
check('英雄最大生命 30（炉石式）', bosses0.json?.heroMaxHp === 30);
check('词灵英雄血量 30/35/40', JSON.stringify(bs.map((b) => b.hp).sort((a, b) => a - b)) === '[30,35,40]',
  `hp=${bs.map((b) => b.hp).join('/')}`);
check('初始今日全未挑战', bs.every((b) => !b.playedToday && !b.wonToday));

/* 3. 挑战第一个词灵：全对 → WIN */
const b1 = bs[0];
const st = await req('POST', '/api/battle/start', { token, body: { bossId: b1.id } });
const sj = st.json;
check('开战成功（英雄 30 血 + 发 5 张手牌）',
  st.status === 200 && sj?.battleId && sj?.total === 10 && sj?.heroHp === 30 && sj?.mana === 0 && Array.isArray(sj?.hand) && sj?.hand?.length === 5,
  `英雄=${sj?.heroHp} 手牌=${sj?.hand?.length} 首题=${sj?.question?.kind}`);
check('手牌属性合法（费用 1-3 · ATK≥3 · HP≥4）',
  sj?.hand?.every((c) => c.cost >= 1 && c.cost <= 3 && c.atk >= 3 && c.atk <= 10 && c.hp >= 4 && c.wordId && c.wordText),
  `卡=${sj?.hand?.map((c) => `${c.wordText}(${c.cost}费/${c.atk}攻)`).join(' ')}`);

let battleId = sj?.battleId;
let done = null;
let answers = 0;
let lastAnswer = null;
let mana = 0;
let bossHp = sj?.bossHp;
let sawSummon = false;
let maxCombo = 0;
for (let i = 0; i < 10 && !done; i++) {
  const q = i === 0 ? sj?.question : lastAnswer?.next;
  if (!q) break;
  // 手牌选卡：选一张当前法力可负担的最高攻卡（测试 cardId 路径）
  const pick = [...(lastAnswer?.hand ?? sj?.hand ?? [])].filter((c) => c.cost <= mana).sort((a, b) => b.atk - a.atk)[0];
  let body;
  if (q.kind === 'spell') body = { battleId, typed: q.wordText, cardId: pick?.wordId };
  else body = { battleId, picked: q.answerKey, cardId: pick?.wordId };
  const a = await req('POST', '/api/battle/answer', { token, body });
  lastAnswer = a.json;
  answers += 1;
  if (a.json?.summoned) sawSummon = true;
  mana = a.json?.mana ?? mana;
  bossHp = a.json?.bossHp ?? bossHp;
  maxCombo = Math.max(maxCombo, a.json?.combo ?? 0);
  if (a.json?.finished) { done = a.json; break; }
  if (a.status !== 200 || !a.json?.next) break;
}
check('全对打出并召唤随从', sawSummon === true && answers >= 3 && answers <= 8,
  `第 ${answers} 题击破 · 最高连击 ${maxCombo}`);
check('全对 → 自动结算为 WIN（英雄满血）',
  !!done && done.finished && done.result === 'win' && done.win === true && done.heroHp === 30,
  `result=${done?.result} 对=${done?.correctCount}/${done?.total} 英雄❤️=${done?.heroHp}`);
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

/* 5. 抽卡资格加成：battle_wins 计入 */
const me = await req('GET', '/api/me', { token });
check('/api/me 返回对战加成后的抽卡资格', me.status === 200 && me.json?.cardDraw?.eligible >= 1,
  `eligible=${me.json?.cardDraw?.eligible}（作答+1 BOSS 胜利）`);

/* 6. 另一个词灵全错 → LOSE（英雄血量耗尽，安慰奖） */
const b2 = bs[1];
const st2 = await req('POST', '/api/battle/start', { token, body: { bossId: b2.id } });
check('第二个词灵可开战', st2.status === 200 && st2.json?.heroHp === 30, `boss=${b2.name}`);
let done2 = null;
battleId = st2.json?.battleId;
let last2 = null;
let heroHp = st2.json?.heroHp;
for (let i = 0; i < 10 && !done2; i++) {
  const q = i === 0 ? st2.json?.question : last2?.next;
  if (!q) break;
  const a = await req('POST', '/api/battle/answer', { token, body: { battleId, picked: 'Z', typed: '__wrong__' } });
  last2 = a.json;
  heroHp = a.json?.heroHp ?? heroHp;
  if (a.json?.finished) { done2 = a.json; break; }
}
check('全错 → LOSE（英雄血量耗尽，被随从反击扣血）',
  !!done2 && done2.result === 'lose' && done2.heroHp === 0,
  `result=${done2?.result} ❤️=${done2?.heroHp} 对=${done2?.correctCount} 反击威胁=${done2?.threat ?? '?'}`);
check('失败给参与奖（5 词力，无卡）', done2?.reward?.points === 5 && done2?.reward?.card === null);

/* 摘要 */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
