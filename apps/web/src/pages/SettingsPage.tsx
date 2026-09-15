import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScheduleMode } from '@app/core';
import { api } from '../lib/api';
import { setSpeechAutoEnabled, speechAutoEnabled, speak } from '../lib/speech';
import { useAuthStore } from '../stores/auth';
import { useSessionStore } from '../stores/session';

/** 设置页：调度模式切换（艾宾浩斯 ⇄ FSRS）、每日新词数、退出登录 */
export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const refreshToday = useSessionStore((s) => s.loadToday);

  const [saving, setSaving] = useState(false);
  const [savedTip, setSavedTip] = useState(false);
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const [devOk, setDevOk] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(() => speechAutoEnabled());

  async function triggerFlash(count: number) {
    setDevBusy(true);
    setDevMsg(null);
    try {
      const r = await api.devReviewNow(count);
      setDevOk(true);
      setDevMsg(`✅ 已拉回 ${r.wordIds.length} 个词：${r.wordIds.join('、')} —— 去「今日学习」看看快闪轮吧！`);
    } catch (err) {
      setDevOk(false);
      setDevMsg(err instanceof Error ? err.message : '触发失败');
    } finally {
      setDevBusy(false);
    }
  }

  useEffect(() => {
    if (savedTip) {
      const t = setTimeout(() => setSavedTip(false), 1800);
      return () => clearTimeout(t);
    }
  }, [savedTip]);

  async function patch(patchBody: Parameters<typeof api.updateMe>[0]) {
    setSaving(true);
    try {
      const res = await api.updateMe(patchBody);
      setUser(res.user);
      // 新词上限变化：立即按新上限重建今日队列（服务端已作废今日计划）
      if (patchBody.dailyNewLimit !== undefined) void refreshToday();
      setSavedTip(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <h1 className="text-lg font-bold text-slate-800">设置</h1>
      {savedTip && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">✅ 已保存</p>}

      {/* 调度模式（设计文档 §4.3 双模式） */}
      <section className="rounded-2xl bg-white p-5 shadow">
        <p className="text-sm font-bold text-slate-700">记忆调度模式</p>
        <p className="mt-1 text-xs text-slate-400">决定每个词「下次什么时候出现」</p>

        <div className="mt-4 space-y-2.5">
          <ModeOption
            active={user?.scheduleMode !== 'fsrs'}
            disabled={saving}
            title="🌱 艾宾浩斯经典"
            desc="固定复习节点：5分钟→30分钟→12小时→1天… 规则透明，等级就是进度条"
            onClick={() => patch({ scheduleMode: 'ebbinghaus' })}
          />
          <ModeOption
            active={user?.scheduleMode === 'fsrs'}
            disabled={saving}
            title="🧠 FSRS 智能"
            desc="按你的遗忘曲线自适应间隔，越用越准（进阶推荐）"
            onClick={() => patch({ scheduleMode: 'fsrs' })}
          />
        </div>
      </section>

      {/* 每日新词数 */}
      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-700">每日新词上限</p>
          <span className="text-sm font-extrabold text-blue-600">{user?.dailyNewLimit ?? 10} 个</span>
        </div>
        <input
          type="range"
          min={2}
          max={50}
          step={1}
          defaultValue={user?.dailyNewLimit ?? 10}
          onMouseUp={(e) => patch({ dailyNewLimit: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => patch({ dailyNewLimit: Number((e.target as HTMLInputElement).value) })}
          className="mt-4 w-full accent-blue-600"
        />
        <p className="mt-1 flex justify-between text-[10px] text-slate-300">
          <span>2</span>
          <span>50</span>
        </p>
      </section>

      {/* 🔊 发音 */}
      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-700">自动朗读单词</p>
            <p className="mt-1 text-xs text-slate-400">看词选义题出题即读；选词/拼写题在揭示答案时朗读（浏览器内置语音）</p>
          </div>
          <button
            onClick={() => {
              const next = !autoSpeak;
              setSpeechAutoEnabled(next);
              setAutoSpeak(next);
              if (next) speak('ability'); // 开启时试读一个词
            }}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${autoSpeak ? 'bg-blue-600' : 'bg-slate-200'}`}
            aria-label="切换自动朗读"
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                autoSpeak ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </section>

      {/* 🧪 本地测试工具（DEV_MODE=1 时后端才放行） */}
      <section className="rounded-2xl bg-white p-5 shadow">
        <p className="text-sm font-bold text-slate-700">🧪 快闪演示工具</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          不想等 5 分钟？把最早到期的已学词立即拉回「今日学习」队列，亲眼看看艾宾浩斯快闪轮（仅本地开发环境有效）。
        </p>
        <div className="mt-3 flex gap-2">
          {[1, 3, 5].map((n) => (
            <button
              key={n}
              disabled={devBusy}
              onClick={() => void triggerFlash(n)}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-40"
            >
              拉回 {n} 个
            </button>
          ))}
        </div>
        {devMsg && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${devOk ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
            {devMsg}
          </p>
        )}
      </section>

      {/* 账号 */}
      <section className="rounded-2xl bg-white p-5 shadow">
        <p className="text-sm font-bold text-slate-700">账号</p>
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <p>{user?.nickname}</p>
          <p>{user?.email}</p>
        </div>
        <button
          onClick={() => {
            logout();
            navigate('/login');
          }}
          className="mt-4 w-full rounded-xl bg-red-50 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-100"
        >
          退出登录
        </button>
      </section>

      <p className="pb-6 pt-2 text-center text-[11px] text-slate-300">词流 WordFlow v0.1.0 · M0 MVP</p>
    </div>
  );
}

function ModeOption({
  active,
  disabled,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
        active ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-[5px] transition ${active ? 'border-blue-600 bg-white' : 'border-slate-200'}`} />
      <span>
        <span className={`block text-sm font-semibold ${active ? 'text-blue-700' : 'text-slate-700'}`}>{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{desc}</span>
      </span>
    </button>
  );
}
