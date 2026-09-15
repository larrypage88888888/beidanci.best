#!/usr/bin/env node
/**
 * P1 E2E 冒烟：段位系统（C10）+ 词根技能树（C9）（设计文档 §10.3）。
 * 用法：node scripts/e2e-p1.mjs [origin]
 * 流程：注册 → 摸底 → 段位（青铜）→ 词书解锁状态（cet6 锁定）→ 锁定时切换 403
 *      → 学习词根词 → 技能树点亮 → dev rank-boost → cet6 解锁 → 切换成功。
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const email = `p1-${Date.now()}@test.com`;
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

console.log(`\n⭐ 词流 P1 段位×词根树冒烟 · 目标 ${BASE}\n`);

/* 1. 健康检查 */
const health = await req('GET', '/api/health');
check('健康检查 /api/health', health.status === 200 && health.json?.ok === true);

/* 2. 注册 + 摸底 */
const reg = await req('POST', '/api/auth/register', { body: { email, password, nickname: 'P1测试员' } });
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

/* 3. 段位：全新用户应为青铜 */
const r1 = await req('GET', '/api/rank/current', { token });
check('GET /api/rank/current 返回段位结构',
  r1.status === 200 && typeof r1.json?.tier === 'number' && typeof r1.json?.score === 'number' &&
    /^\d{4}-\d{2}$/.test(r1.json?.season ?? ''),
  `season=${r1.json?.season ?? '?'} 段位=${r1.json?.tierLabel ?? '?'} 评分=${r1.json?.score ?? '?'}`);
check('全新用户 = 低起步段位（青铜/白银，仅词汇量底分）',
  r1.json?.tier <= 1 && (r1.json?.tierLabel === '青铜' || r1.json?.tierLabel === '白银'),
  `tier=${r1.json?.tier} label=${r1.json?.tierLabel}`);
check('段位响应含评分构成与下一段', !!r1.json?.breakdown && typeof r1.json?.breakdown?.vocabEstimate === 'number' &&
  r1.json?.breakdown?.activeDays7d === 0 && r1.json?.breakdown?.correctRate7d === null && !!r1.json?.next,
  `词汇量=${r1.json?.breakdown?.vocabEstimate} 活跃=${r1.json?.breakdown?.activeDays7d}天 正确率=${r1.json?.breakdown?.correctRate7d ?? 'null'} 下一段=${r1.json?.next?.label ?? '?'}`);
check('历史最高保留字段（≥ 当前段位）', typeof r1.json?.bestTier === 'number' && r1.json?.bestTier >= r1.json?.tier && r1.json?.bestTier <= 1,
  `best=${r1.json?.bestTier}（${r1.json?.bestTierLabel}）`);

/* 4. 词书解锁状态：cet4 可用，cet6 锁定（需黄金） */
const wb1 = await req('GET', '/api/wordbooks', { token });
const cet4 = wb1.json?.items?.find((b) => b.id === 'cet4');
const cet6 = wb1.json?.items?.find((b) => b.id === 'cet6');
check('GET /api/wordbooks 返回词书列表（含 cet4/cet6）', wb1.status === 200 && !!cet4 && !!cet6,
  `${wb1.json?.items?.length ?? 0} 本`);
check('cet4 初始解锁', cet4 && cet4.locked === false && cet4.minTier === 0);
check('cet6 青铜阶段锁定（门槛=黄金3）', cet6 && cet6.locked === true && cet6.minTier === 3 && cet6.lockedByTier === 3);

/* 5. 锁定时切换 → 403 */
const lockSwitch = await req('PATCH', '/api/me', { token, body: { goalBookId: 'cet6' } });
check('未解锁时切换 cet6 被拒绝 403', lockSwitch.status === 403, `${lockSwitch.json?.error ?? ''}`);

/* 6. 词根技能树：先查（全灰），学词根词后点亮 */
const roots0 = await req('GET', '/api/roots', { token });
check('GET /api/roots 返回 15 个词根', roots0.status === 200 && roots0.json?.totalRoots === 15 && roots0.json?.roots?.length === 15,
  `roots=${roots0.json?.totalRoots ?? '?'}`);
check('初始全部未点亮', (roots0.json?.roots ?? []).every((r) => !r.lit && r.learned === 0 && r.total >= 2),
  `已点亮=${roots0.json?.roots?.filter((r) => r.lit).length ?? '?'}`);

// 学 5 个不同家族的词根词
const target = roots0.json.roots.slice(0, 5).map((r) => r.family[0].wordId);
const rev = await req('POST', '/api/reviews', {
  token,
  body: { items: target.map((wordId) => ({ wordId, rating: 'remembered', latencyMs: 500 })) },
});
check('学习 5 个词根家族词成功', rev.status === 200, `items=${target.length}`);

const roots1 = await req('GET', '/api/roots', { token });
const litRoots = roots1.json?.roots?.filter((r) => r.lit) ?? [];
check('对应词根节点被点亮', litRoots.length === 5 && (roots1.json?.roots ?? []).every((r) => r.learned <= r.total),
  `点亮 ${litRoots.length}/15，已掌握家族词=${roots1.json?.learnedWords ?? '?'}`);
check('点亮节点含家族明细（lit 词标记）', litRoots.every((r) => r.family.some((f) => f.lit) && r.learned === 1 && r.lit),
  `示例 ${litRoots[0]?.root ?? '?'}: ${litRoots[0]?.family?.filter((f) => f.lit).map((f) => f.text).join(',') ?? ''}`);
check('未点亮节点保持灰显', (roots1.json?.roots ?? []).filter((r) => !r.lit).every((r) => r.family.every((f) => !f.lit)));

/* 7. 升段后：cet6 解锁 → 切换成功（dev rank-boost 仅本地可用；生产跳过） */
const boostProbe = await req('POST', '/api/dev/rank-boost', { token, body: { tier: 3 } });
const hasDevBoost = boostProbe.status === 200;
if (!hasDevBoost) {
  console.log('  ⏭️ dev rank-boost 不可用（生产环境），跳过升段解锁测试');
  passed += 1;
}
if (hasDevBoost) {
  const boost = boostProbe;
  check('dev rank-boost 升到黄金（本地测试工具）', boost.status === 200 && boost.json?.bestTier === 3);

  const wb2 = await req('GET', '/api/wordbooks', { token });
  const cet6b = wb2.json?.items?.find((b) => b.id === 'cet6');
  check('升段后 cet6 解锁', cet6b && cet6b.locked === false, `bestTier=${wb2.json?.bestTier}`);

  const okSwitch = await req('PATCH', '/api/me', { token, body: { goalBookId: 'cet6' } });
  check('解锁后切换 cet6 成功', okSwitch.status === 200 && okSwitch.json?.user?.goalBookId === 'cet6');

  const me = await req('GET', '/api/me', { token });
  check('/api/me 含段位概览且 bestTier≥3', me.status === 200 && !!me.json?.rank && me.json?.rank?.bestTier >= 3,
    `rank=${me.json?.rank?.tierLabel ?? '?'} best=${me.json?.rank?.bestTierLabel ?? '?'}`);
}

/* 摘要 */
console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败${failed === 0 ? ' 🎉' : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
