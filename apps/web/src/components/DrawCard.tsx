import { useState } from 'react';
import { api } from '../lib/api';
import type { DrawResponse } from '../lib/types';
import { playDraw } from '../lib/sfx';

export const RARITY_META: Record<string, { label: string; text: string; card: string; badge: string }> = {
  SR: {
    label: 'SR 精良',
    text: 'text-blue-600',
    card: 'from-blue-400 to-indigo-500',
    badge: 'bg-blue-100 text-blue-700',
  },
  SSR: {
    label: 'SSR 史诗',
    text: 'text-violet-600',
    card: 'from-violet-400 to-purple-600',
    badge: 'bg-violet-100 text-violet-700',
  },
  UR: {
    label: 'UR 传说',
    text: 'text-amber-600',
    card: 'from-amber-300 via-orange-400 to-rose-400',
    badge: 'bg-amber-100 text-amber-700',
  },
};

/** 抽卡按钮（完成页）：剩余次数 >0 时显示；抽卡结果由父组件弹窗展示 */
export default function DrawCardButton({
  remaining,
  onDrawn,
  onError,
}: {
  remaining: number;
  onDrawn: (res: DrawResponse) => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (remaining <= 0) return null;

  async function draw() {
    setBusy(true);
    try {
      const res = await api.cardsDraw();
      playDraw();
      onDrawn(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : '抽卡失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void draw()}
      disabled={busy}
      className="mt-3 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 py-3 font-medium text-white shadow-md shadow-purple-200 transition hover:from-fuchsia-600 hover:to-purple-700 disabled:opacity-60"
    >
      {busy ? '抽卡中…' : `🎴 抽词卡（今日剩 ${remaining} 次）`}
    </button>
  );
}

/** 抽卡结果弹窗：稀有度光效 + 词卡正面 */
export function DrawResultModal({ result, onClose }: { result: DrawResponse; onClose: () => void }) {
  const meta = RARITY_META[result.card.rarity] ?? RARITY_META.SR;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="wf-pop w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {result.card.duplicate ? (
          <>
            <p className="text-4xl">🎁</p>
            <p className={`mt-2 text-sm font-bold ${meta.text}`}>重复收藏 · {meta.label}</p>
            <p className="mt-1 text-3xl font-extrabold text-amber-500">+{result.card.pointsGained} 词力</p>
            <p className="mt-1 text-xs text-slate-400">重复词卡已自动转为词力积分（可兑换装饰）</p>
          </>
        ) : (
          <>
            <p className={`mx-auto wf-glow-ur flex h-44 w-32 flex-col justify-center rounded-2xl bg-gradient-to-br ${meta.card} p-3 text-white shadow-lg`}>
              <span className={`mx-auto rounded-full px-2 py-0.5 text-[10px] font-extrabold ${meta.badge}`}>
                {meta.label}
              </span>
              <span className="mt-3 text-xl font-extrabold leading-tight tracking-wide">{result.card.text}</span>
              {result.card.phonetic && <span className="mt-1 text-[10px] opacity-90">{result.card.phonetic}</span>}
              <span className="mt-2 text-[10px] leading-snug opacity-95">
                {result.card.definitions[0]?.meaning ?? ''}
              </span>
              <span className="mt-3 text-lg">✨</span>
            </p>
            <p className="mt-3 text-xs text-slate-400">已加入你的词卡图鉴 🃏</p>
          </>
        )}
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          收下
        </button>
      </div>
    </div>
  );
}
