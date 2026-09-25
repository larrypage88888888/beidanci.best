import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

/** 忘记密码：输入注册邮箱 → 发送重置链接（DEV_MODE 下直接返回测试链接） */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ message: string; devLink?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.forgotPassword(email.trim());
      setSent({ message: res.message, devLink: res.devLink });
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了，请重试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl shadow-blue-100">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">找回密码</h1>
          <p className="mt-1 text-xs text-slate-400">输入注册邮箱，我们会发送重置链接</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm leading-relaxed text-emerald-700">
              📧 {sent.message}
            </p>
            {sent.devLink && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
                本地开发模式（未发真邮件）：
                <Link to={`/reset-password?token=${sent.devLink.split('token=')[1]}`} className="ml-1 font-medium underline">
                  点此直接打开重置页 →
                </Link>
              </p>
            )}
            <Link to="/login" className="block text-center text-sm font-medium text-blue-600 hover:underline">
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="注册邮箱"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '发送中…' : '发送重置链接'}
            </button>
            <Link to="/login" className="block text-center text-xs text-slate-400 hover:text-blue-600">
              想起密码了？返回登录
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
