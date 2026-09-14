import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { CardItem, CardRarity, CollectionResponse } from '../lib/types';
import { RARITY_META } from '../components/DrawCard';

const RARITY_ORDER: CardRarity[] = ['UR', 'SSR', 'SR'];

/** 词卡图鉴（P0 §十 A2）：收集到的词卡 + 词力积分 + 今日抽卡资格 */
export default function CollectionPage() {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .cardsCollection()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载图鉴失败'));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-4xl">😵</p>
        <p className="mt-3 text-sm text-slate-500">{error}</p>
        <button onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-600">
          刷新重试
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-2xl bg-white shadow" />
          <div className="grid grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-36 rounded-2xl bg-white shadow" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const grouped: Record<CardRarity, CardItem[]> = { UR: [], SSR: [], SR: [] };
  for (const item of data.items) {
    grouped[item.rarity]?.push(item);
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      {/* 头部 */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">🃏 词卡图鉴</h1>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-600">
          ✨ {data.points} 词力
        </span>
      </div>

      {/* 抽卡资格 */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
        <p className="text-xs text-slate-500">
          今天已收集 <b className="text-slate-700">{data.counts.total}</b> 张卡 · 可抽{' '}
          <b className="text-fuchsia-600">{data.draw.remaining}</b> 次
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          每天累计作答 15 词可抽 1 次，当日最高连击 10+ 额外 +1 次
        </p>
        <Link to="/today" className="mt-2 block rounded-lg bg-fuchsia-50 py-2 text-center text-xs font-medium text-fuchsia-600 hover:bg-fuchsia-100">
          去学习赚抽卡次数 →
        </Link>
      </div>

      {/* 按稀有度分组 */}
      {RARITY_ORDER.map((rarity) => {
        const list = grouped[rarity] ?? [];
        if (list.length === 0) return null;
        const meta = RARITY_META[rarity];
        return (
          <section key={rarity} className="mb-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-bold">
              <span className={`rounded-full px-2 py-0.5 ${meta.badge}`}>{meta.label}</span>
              <span className="text-slate-400">{list.length} 张</span>
            </h2>
            <div className="grid grid-cols-3 gap-3">
              {list.map((item) => (
                <div
                  key={item.wordId}
                  className={`flex h-32 flex-col justify-between rounded-2xl bg-gradient-to-br ${meta.card} p-3 text-white shadow-md ${rarity === 'UR' ? 'wf-glow-ur' : ''}`}
                >
                  <span className="text-[10px] font-extrabold opacity-90">{rarity}</span>
                  <span className="text-base font-extrabold leading-tight tracking-wide">{item.text}</span>
                  <span className="line-clamp-2 text-[9px] leading-snug opacity-90">
                    {item.definitions[0]?.meaning ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {data.counts.total === 0 && (
        <div className="mt-10 text-center">
          <p className="text-5xl">🃏</p>
          <p className="mt-3 text-sm text-slate-500">还没有收集到词卡</p>
          <p className="mt-1 text-xs text-slate-400">完成每天的学习任务即可抽卡集卡</p>
        </div>
      )}
    </div>
  );
}
