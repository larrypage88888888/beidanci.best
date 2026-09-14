import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { RootNode, RootsResponse } from '../lib/types';

/** 词根技能树（C9 §10.3）：学到含某词根的词 → 点亮节点（SVG 零依赖径向图） */
export default function RootsPage() {
  const [data, setData] = useState<RootsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .roots()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <p className="text-4xl">🌳</p>
        <p className="mt-3 text-sm text-slate-500">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-2xl bg-white shadow" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-48 rounded-2xl bg-white shadow" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const litRoots = data.roots.filter((r) => r.lit).length;

  return (
    <div className="mx-auto max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">🌳 词根技能树</h1>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-600">
          点亮 {litRoots}/{data.totalRoots}
        </span>
      </div>

      {/* 总进度 */}
      <div className="mt-3 mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>已掌握词根家族词</span>
          <span>
            <b className="text-emerald-600">{data.learnedWords}</b> 个
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all"
            style={{ width: `${Math.min(100, (litRoots / Math.max(1, data.totalRoots)) * 100)}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          学习包含这些词根的单词即可点亮节点，一眼看出「xx 家族」你掌握了几个。
        </p>
      </div>

      {/* 词根卡片：SVG 径向网络图 */}
      <div className="grid grid-cols-2 gap-3">
        {data.roots.map((r) => (
          <RootCard key={r.root} node={r} />
        ))}
      </div>
    </div>
  );
}

const R = 64; // 节点到中心的半径
const CX = 80;
const CY = 78;

function RootCard({ node }: { node: RootNode }) {
  const angle = (i: number, n: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  return (
    <div
      className={`rounded-2xl bg-white p-3 shadow-sm ring-1 transition ${
        node.lit ? 'ring-emerald-200' : 'ring-slate-100'
      }`}
    >
      <svg viewBox="0 0 160 156" className="mx-auto w-full max-w-[180px]">
        {/* 连线 */}
        {node.family.map((w, i) => {
          const a = angle(i, node.family.length);
          return (
            <line
              key={w.wordId}
              x1={CX}
              y1={CY}
              x2={CX + R * Math.cos(a)}
              y2={CY + R * Math.sin(a)}
              stroke={w.lit ? '#10b981' : '#e2e8f0'}
              strokeWidth={1.2}
            />
          );
        })}
        {/* 中心词根 */}
        <circle cx={CX} cy={CY} r={26} fill={node.lit ? '#d1fae5' : '#f1f5f9'} stroke={node.lit ? '#10b981' : '#cbd5e1'} strokeWidth={1.5} />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={node.lit ? '#047857' : '#64748b'}>
          {node.emoji ?? ''}
        </text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="11" fontWeight="700" fill={node.lit ? '#047857' : '#64748b'}>
          -{node.root}-
        </text>
        {/* 家族词节点 */}
        {node.family.map((w, i) => {
          const a = angle(i, node.family.length);
          const x = CX + R * Math.cos(a);
          const y = CY + R * Math.sin(a);
          const lit = w.lit;
          return (
            <g key={w.wordId}>
              <circle cx={x} cy={y} r={17} fill={lit ? '#10b981' : '#f8fafc'} stroke={lit ? '#059669' : '#cbd5e1'} strokeWidth={1.2} />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight={lit ? '700' : '400'}
                fill={lit ? '#ffffff' : '#94a3b8'}
              >
                {w.text.length > 9 ? `${w.text.slice(0, 8)}…` : w.text}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-xs font-bold text-slate-700">
        {node.emoji} {node.meaning} · -{node.root}-
      </p>
      <p className={`text-center text-[11px] ${node.lit ? 'text-emerald-600' : 'text-slate-400'}`}>
        {node.lit ? `已掌握 ${node.learned}/${node.total}` : `未点亮 · 共 ${node.total} 词`}
      </p>
    </div>
  );
}
