import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { RankResponse, WordbooksResponse } from '../lib/types';
import { useAuthStore } from '../stores/auth';

const TIER_LADDER = [
  { tier: 0, label: '青铜', emoji: '🥉', min: 0 },
  { tier: 1, label: '白银', emoji: '🥈', min: 24 },
  { tier: 2, label: '黄金', emoji: '🥇', min: 42 },
  { tier: 3, label: '铂金', emoji: '💠', min: 58 },
  { tier: 4, label: '钻石', emoji: '💎', min: 73 },
  { tier: 5, label: '词霸', emoji: '👑', min: 88 },
];

/** ⭐ 段位页（C10 §10.3）：赛季评分、段位阶梯、词书解锁 */
export default function RankPage() {
  const [rank, setRank] = useState<RankResponse | null>(null);
  const [books, setBooks] = useState<WordbooksResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const goalBookId = useAuthStore((s) => s.user?.goalBookId);

  const load = useCallback(() => {
    void Promise.all([api.rankCurrent(), api.wordbooks()])
      .then(([r, b]) => {
        setRank(r);
        setBooks(b);
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : '加载失败'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function switchBook(bookId: string) {
    setBusy(bookId);
    try {
      await api.updateMe({ goalBookId: bookId });
      await refreshMe();
      setNotice('已切换目标词书，明天的今日学习将使用新词书选词');
      load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '切换失败');
    } finally {
      setBusy(null);
    }
  }

  const pct = rank ? Math.min(100, (rank.score / 100) * 100) : 0;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">⭐ 段位</h1>
        {rank && (
          <span className="text-xs text-slate-400">
            赛季 {rank.season} · 历史最高 {rank.bestTierEmoji} {rank.bestTierLabel}
          </span>
        )}
      </div>

      {/* 当前段位卡 */}
      {rank && (
        <div className="rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 p-6 text-white shadow-lg">
          <p className="text-xs opacity-80">当前段位</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-5xl">{rank.tierEmoji}</span>
            <div>
              <p className="text-2xl font-extrabold">{rank.tierLabel}</p>
              <p className="text-xs opacity-90">评分 {rank.score} / 100</p>
            </div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
          </div>
          {rank.next ? (
            <p className="mt-2 text-[11px] opacity-90">
              距 {rank.next.emoji} {rank.next.label} 还差 <b>{rank.next.neededScore}</b> 分
            </p>
          ) : (
            <p className="mt-2 text-[11px] opacity-90">已登顶词霸，太强了！</p>
          )}
        </div>
      )}

      {/* 评分构成 */}
      {rank && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-bold text-slate-700">评分构成（满分 100）</p>
          <div className="space-y-2.5 text-sm">
            <Row label="📖 词汇量" value={rank.breakdown.vocabEstimate.toLocaleString()} sub="log 缩放 · 占 45 分" />
            <Row
              label="🎯 近 7 天正确率"
              value={rank.breakdown.correctRate7d == null ? '暂无数据' : `${Math.round(rank.breakdown.correctRate7d * 100)}%`}
              sub="占 25 分 · 需有活跃"
            />
            <Row label="📅 近 7 天活跃" value={`${rank.breakdown.activeDays7d} 天`} sub="占 30 分 · 全勤封顶" />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            每月 1 号结算一次；历史最高段位保留，解锁的进阶词书不会因段位回落而关闭。
          </p>
        </div>
      )}

      {/* 段位阶梯 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-bold text-slate-700">段位阶梯</p>
        <div className="space-y-1.5">
          {TIER_LADDER.map((t) => {
            const current = rank?.tier === t.tier;
            const passed = (rank?.bestTier ?? -1) >= t.tier;
            return (
              <div
                key={t.tier}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                  current ? 'bg-amber-50 font-bold text-amber-700 ring-1 ring-amber-200' : 'text-slate-600'
                }`}
              >
                <span className="text-xl">{t.emoji}</span>
                <span className="flex-1">
                  {t.label}
                  {current && <span className="ml-2 text-[10px] text-amber-500">当前</span>}
                  {!current && passed && <span className="ml-2 text-[10px] text-emerald-500">已达成</span>}
                </span>
                <span className="text-[11px] text-slate-400">{t.min} 分起</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 词书解锁 */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="mb-1 text-sm font-bold text-slate-700">词书解锁</p>
        <p className="mb-3 text-[11px] text-slate-400">段位越高，解锁更高难度 CEFR 词包（切换后次日生效）</p>
        <div className="space-y-2.5">
          {books?.items.map((b) => {
            const current = goalBookId === b.id;
            return (
              <div key={b.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="text-2xl">{b.locked ? '🔒' : '📖'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-700">
                    {b.name}
                    {current && <span className="ml-1.5 text-[10px] font-bold text-blue-500">当前</span>}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">{b.description}</p>
                </div>
                {b.locked ? (
                  <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500">
                    {TIER_LADDER[b.lockedByTier ?? 0]?.emoji} {TIER_LADDER[b.lockedByTier ?? 0]?.label}解锁
                  </span>
                ) : (
                  <button
                    onClick={() => void switchBook(b.id)}
                    disabled={busy === b.id || current}
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
                  >
                    {busy === b.id ? '切换中…' : current ? '使用中' : '选择'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {notice && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-600">{notice}</p>
      )}
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-slate-700">{label}</p>
        <p className="text-[10px] text-slate-400">{sub}</p>
      </div>
      <p className="font-bold text-slate-800">{value}</p>
    </div>
  );
}
