import { speak } from '../lib/speech';

/** 🔊 手动朗读按钮 —— 放在单词旁边，点击即读（不受自动朗读开关影响） */
export default function SpeakerButton({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`朗读 ${text}`}
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-lg text-blue-500 transition hover:bg-blue-100 active:scale-90 ${className}`}
    >
      🔊
    </button>
  );
}
