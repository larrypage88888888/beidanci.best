import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

/** 登录 / 注册（M0：邮箱 + 密码；后续可加微信/Apple OAuth） */
export default function AuthPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === 'login') await login(email, password);
      else await register(email, password, nickname);
      navigate('/today');
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
          <img src="/icon.svg" alt="" className="mx-auto h-14 w-14 rounded-2xl shadow" />
          <h1 className="mt-3 text-2xl font-bold text-slate-800">词流</h1>
          <p className="mt-1 text-xs text-slate-400">围绕你的水平流动的个人化词单</p>
        </div>

        {/* Tab 切换 */}
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`rounded-lg py-2 transition ${
                tab === t ? 'bg-white text-blue-600 shadow' : 'text-slate-400'
              }`}
            >
              {t === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          {tab === 'register' && (
            <input
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="昵称"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          )}
          <input
            type="password"
            required
            minLength={tab === 'register' ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={tab === 'register' ? '密码（至少 8 位）' : '密码'}
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '请稍候…' : tab === 'login' ? '登录' : '注册并开始'}
          </button>
        </form>
      </div>
    </div>
  );
}
