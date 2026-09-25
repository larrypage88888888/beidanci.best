import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

/** 邮件链接重置密码：?token=xxx → 设置新密码 → 回登录页 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了，请重试');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-100 px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl shadow-blue-100">
          <p className="text-sm text-slate-600">重置链接无效（缺少令牌）</p>
          <Link to="/forgot" className="mt-4 inline-block text-sm font-medium text-blue-600 hover:underline">
            重新申请重置链接
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-blue-50 via-slate-50 to-indigo-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl shadow-blue-100">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-slate-800">设置新密码</h1>
          <p className="mt-1 text-xs text-slate-400">至少 8 位，请牢记新密码</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">✅ 密码已重置，请用新密码登录</p>
            <Link
              to="/login"
              className="block w-full rounded-xl bg-blue-600 py-3 text-center font-medium text-white transition hover:bg-blue-700"
            >
              去登录
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新密码（至少 8 位）"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="再输入一次"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? '提交中…' : '重置密码'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
