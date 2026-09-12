import { useEffect } from 'react';
import { difficultyToCefr, estimateVocabSize } from '@app/core';
import { useAuthStore } from '../stores/auth';
import { useSessionStore } from '../stores/session';

/** 统计页：水平轴、streak、今日数据（M0 版；M1 加徽章墙与留存曲线） */
export default function StatsPage() {
  const user = useAuthStore((s) => s.user);
  const streak = useAuthStore((s) => s.streak);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const session = useSessionStore();

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const level = user?.level ?? 50;
  const vocab = estimateVocabSize(level);
  const cefr = difficultyToCefr(level);

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <h1 className="text-lg font-bold text-slate-800">学习统计</h1>

      {/* 能力卡片 */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-6 text-white shadow-lg">
        <p className="text-xs opacity-70">预估词汇量</p>
        <p className="mt-1 text-4xl font-extrabold">{vocab.toLocaleString()}</p>
        <div className="mt-5">
          <div className="flex items-center justify-between text-[11px] opacity-80">
            <span>难度轴位置</span>
            <span>
              {cefr} · {level.toFixed(0)}/100
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white" style={{ width: `${level}%` }} />
          </div>
        </div>
      </div>

      {/* streak 卡片 */}
      <div className="flex items-center justify-between rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center gap-3">
          <span className={`text-3xl ${streak > 0 ? 'wf-pop' : 'opacity-30'}`}>🔥</span>
          <div>
            <p className="font-bold text-slate-800">连续打卡 {streak} 天</p>
            <p className="text-xs text-slate-400">今天学完就续上啦</p>
          </div>
        </div>
      </div>

      {/* 今日数据 */}
      <div className="rounded-2xl bg-white p-5 shadow">
        <p className="mb-3 text-sm font-bold text-slate-700">今天</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Cell label="新学" text={`${session.newQuotaUsed}`} />
          <Cell label="作答" value={session.summary.total} />
          <Cell label="记得" value={session.summary.remembered} />
          <Cell
            label="正确率"
            text={
              session.summary.total > 0
                ? `${Math.round((session.summary.remembered / session.summary.total) * 100)}%`
                : '—'
            }
          />
        </div>
      </div>

      {/* 调度模式 */}
      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-700">调度模式</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {user?.scheduleMode === 'fsrs' ? 'FSRS 智能：按你的遗忘曲线自适应' : '艾宾浩斯经典：固定节点，规则透明'}
            </p>
          </div>
          <a href="/settings" className="text-xs font-medium text-blue-600 hover:underline">
            去切换 →
          </a>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-3">
      <p className="text-lg font-bold text-slate-700">{text ?? value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}
