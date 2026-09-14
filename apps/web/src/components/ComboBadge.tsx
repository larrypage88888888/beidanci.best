import { useEffect, useRef, useState } from 'react';
import { comboLevel } from '@app/core';

const PRAISES = ['稳了！', '不错哦', '漂亮！', '太强了', '手感火热', '词霸附体', '保持住！', '天生词圣'];

/** 连击档位样式（P0 §十 A1） */
const LEVEL_STYLE = [
  'bg-slate-100 text-slate-600 border-slate-200', // 1-4 普通
  'bg-orange-100 text-orange-600 border-orange-200', // 5-9 火苗
  'bg-violet-100 text-violet-600 border-violet-300 shadow-violet-200', // 10-49 电光
  'bg-amber-100 text-amber-600 border-amber-300 wf-glow-ur', // 50+ 传说
];

const LEVEL_ICON = ['', '🔥', '⚡', '👑'];

/**
 * 学习页连击徽章：答对连击 +1 并弹出夸奖短语；档位越高视觉越夸张。
 */
export default function ComboBadge({ count, best }: { count: number; best: number }) {
  const [phrase, setPhrase] = useState<string | null>(null);
  const [popKey, setPopKey] = useState(0);
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current && count > 0) {
      setPopKey((k) => k + 1);
      setPhrase(PRAISES[Math.floor(Math.random() * PRAISES.length)] ?? '稳了！');
      const t = setTimeout(() => setPhrase(null), 1400);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count]);

  if (count <= 0) {
    return (
      <div className="flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 text-[11px] text-slate-400">
        <span>连击</span>
        <span className="font-bold">0</span>
      </div>
    );
  }

  const level = comboLevel(count);
  return (
    <div className="relative flex items-center gap-2">
      <div
        key={popKey}
        className={`wf-combo-pop flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-extrabold ${LEVEL_STYLE[level]}`}
      >
        <span className="text-base leading-none">{LEVEL_ICON[level]}</span>
        <span>{count}</span>
        {best > count && <span className="text-[10px] font-medium opacity-60">纪录 {best}</span>}
      </div>
      {phrase && (
        <span className="wf-fade-up absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-800/90 px-2 py-0.5 text-[11px] font-bold text-white">
          {phrase}
        </span>
      )}
    </div>
  );
}
