/**
 * 邮件发送（Resend HTTP API，Workers 兼容，无需 SMTP）。
 * https://resend.com —— 免费额度 100 封/天，需在 Resend 控制台验证发件域名（SPF/DKIM）。
 */

import type { Env } from '../env';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
  /** email_not_configured | resend_<status> */
  error?: string;
}

/** 发送邮件；未配置 RESEND_API_KEY 时返回 email_not_configured（调用方决定降级行为） */
export async function sendEmail(env: Env, msg: EmailMessage): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'email_not_configured' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? '词流 WordFlow <onboarding@resend.dev>',
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
      }),
    });
    if (!res.ok) return { ok: false, error: `resend_${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/** 密码重置邮件模板 */
export function passwordResetEmail(link: string): { subject: string; html: string } {
  return {
    subject: '词流 WordFlow · 重置你的密码',
    html: `
<div style="max-width:480px;margin:0 auto;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#334155">
  <h2 style="color:#1e293b">重置你的密码</h2>
  <p>你好，</p>
  <p>我们收到了你重置「词流 WordFlow」账号密码的请求。点击下面的按钮设置新密码：</p>
  <p style="margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600">重置密码</a>
  </p>
  <p style="font-size:13px;color:#64748b">如果按钮无法点击，请复制此链接到浏览器打开：<br/><span style="word-break:break-all">${link}</span></p>
  <p style="font-size:13px;color:#64748b">链接 30 分钟内有效，且只能使用一次。如果这不是你本人的操作，请忽略本邮件。</p>
</div>`,
  };
}
