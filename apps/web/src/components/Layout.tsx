import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

/** 响应式布局：手机底部 Tab，桌面侧边栏（设计文档 §五：手机竖屏/桌面宽屏） */
export default function Layout({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const streak = useAuthStore((s) => s.streak);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const navItems = [
    { to: '/today', label: '今日学习', icon: '📖' },
    { to: '/words', label: '词库', icon: '📚' },
    { to: '/cards', label: '图鉴', icon: '🃏' },
    { to: '/stats', label: '统计', icon: '📊' },
    { to: '/settings', label: '设置', icon: '⚙️' },
  ];

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
        <StreakBadge streak={streak} />
      </header>

      {/* 桌面侧边栏 */}
      <aside className="hidden w-56 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 md:flex">
        <div>
          <div className="mb-8 flex items-center justify-between">
            <Logo />
            <StreakBadge streak={streak} />
          </div>
          <nav className="space-y-1">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `block rounded-lg px-4 py-2.5 text-sm font-medium transition ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                  }`
                }
              >
                <span className="mr-2">{n.icon}</span>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
          <p className="font-medium text-slate-700">{user?.nickname ?? '同学'}</p>
          <p className="mt-0.5 truncate">{user?.email}</p>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-2 text-red-500 hover:underline"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 内容区（底部留出手机 Tab 高度） */}
      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      {/* 手机底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-slate-200 bg-white/95 backdrop-blur md:hidden">
        {navItems.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                isActive ? 'text-blue-600' : 'text-slate-400'
              }`
            }
          >
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
      <span className="text-base font-bold tracking-wide text-slate-800">词流</span>
    </div>
  );
}

function StreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null;
  return (
    <span className="wf-pop inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-600">
      🔥 {streak} 天
    </span>
  );
}
