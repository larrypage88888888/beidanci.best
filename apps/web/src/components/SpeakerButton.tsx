import { useEffect, useState } from 'react';
import { speak, speechProbe } from '../lib/speech';

/** 🔊 手动朗读按钮 —— 放在单词旁边，点击即读（不受自动朗读开关影响）；
 *  点击后探测引擎是否真的在朗读，没出声就在按钮下方冒出诊断提示 */
export default function SpeakerButton({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 3200);
    return () => clearTimeout(t);
  }, [hint]);

  async function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    speak(text);
    const ok = await speechProbe(400);
    setHint(ok ? null : '🔇 未检测到发声（查音量/静音键，或刷新页面）');
  }

  return (
    <button
      type="button"
      aria-label={`朗读 ${text}`}
      onClick={(e) => void handleClick(e)}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-lg text-blue-500 transition hover:bg-blue-100 active:scale-90 ${className}`}
    >
      🔊
      {hint && (
        <span className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800/95 px-2 py-1 text-[10px] font-medium text-white shadow-lg">
          {hint}
        </span>
      )}
    </button>
  );
}
