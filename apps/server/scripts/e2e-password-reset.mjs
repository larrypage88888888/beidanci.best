#!/usr/bin/env node
/**
 * 密码重置 E2E（本地 DEV_MODE）：
 * 注册 → forgot 拿 devLink → 重置密码 → 旧密码失效 / 新密码可登录 / 令牌一次性 / 防刷与不泄露注册状态。
 * 用法：node scripts/e2e-password-reset.mjs [origin]
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

console.log('🧪 密码重置 E2E');
const email = `pwreset-${Date.now()}@t.com`;
const oldPassword = 'old-pass-12345';
const newPassword = 'new-pass-67890';

const reg = await req('POST', '/api/auth/register', { body: { email, password: oldPassword, nickname: '改密测试' } });
check('注册成功', reg.status === 201 || reg.status === 200, `status=${reg.status}`);

// 1. 忘记密码 → DEV_MODE 返回 devLink
const forgot = await req('POST', '/api/auth/forgot', { body: { email } });
check('POST /api/auth/forgot 成功', forgot.status === 200 && forgot.json?.ok === true);
check('DEV_MODE 返回 devLink', typeof forgot.json?.devLink === 'string' && forgot.json.devLink.includes('/reset-password?token='));
const resetToken = forgot.json?.devLink?.split('token=')[1] ?? '';

// 2. 防刷：同一邮箱 60 秒内重复申请 → 429
const forgot2 = await req('POST', '/api/auth/forgot', { body: { email } });
check('重复申请被限流 429', forgot2.status === 429, `status=${forgot2.status}`);

// 3. 不泄露注册状态：未注册邮箱也返回统一成功（且无 devLink）
const forgotGhost = await req('POST', '/api/auth/forgot', { body: { email: `ghost-${Date.now()}@t.com` } });
check('未注册邮箱返回统一成功', forgotGhost.status === 200 && forgotGhost.json?.ok === true);
check('未注册邮箱不返回 devLink（不泄露注册状态）', !forgotGhost.json?.devLink);

// 4. 重置：弱密码拒绝
const weak = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: '123' } });
check('弱密码被拒绝 400', weak.status === 400, `status=${weak.status}`);

// 5. 正常重置
const ok = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: newPassword } });
check('重置密码成功', ok.status === 200 && ok.json?.ok === true);

// 6. 令牌一次性：重放 → 400
const replay = await req('POST', '/api/auth/reset', { body: { token: resetToken, password: 'another-pass-1' } });
check('令牌重放被拒绝（一次性）', replay.status === 400, `status=${replay.status}`);

// 7. 垃圾令牌 → 400
const garbage = await req('POST', '/api/auth/reset', { body: { token: 'f'.repeat(64), password: newPassword } });
check('垃圾令牌被拒绝', garbage.status === 400, `status=${garbage.status}`);

// 8. 旧密码失效 / 新密码可登录
const loginOld = await req('POST', '/api/auth/login', { body: { email, password: oldPassword } });
check('旧密码已失效 401', loginOld.status === 401, `status=${loginOld.status}`);
const loginNew = await req('POST', '/api/auth/login', { body: { email, password: newPassword } });
check('新密码可登录', loginNew.status === 200 && !!loginNew.json?.token, `status=${loginNew.status}`);
check('登录返回同一用户', loginNew.json?.user?.email === email);

console.log(`\n📊 结果：${passed} 通过 / ${failed} 失败 ${failed === 0 ? '🎉' : ''}`);
process.exit(failed === 0 ? 0 : 1);
