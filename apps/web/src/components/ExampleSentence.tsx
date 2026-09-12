import SpeakerButton from './SpeakerButton';

/**
 * 例句展示：英文句中高亮目标词（大小写不敏感），下方附中文翻译 + 🔊 朗读整句
 */
export default function ExampleSentence({
  sentence,
  zh,
  word,
}: {
  sentence: string;
  zh?: string;
  word: string;
}) {
  return (
    <div className="mt-5 rounded-xl bg-indigo-50/70 px-4 py-3 text-left">
      <p className="text-[13px] leading-relaxed text-slate-600">
        <Highlighted sentence={sentence} word={word} />
        <SpeakerButton text={sentence} className="ml-1.5 !h-6 !w-6 align-middle !text-xs" />
      </p>
      {zh && <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{zh}</p>}
    </div>
  );
}

/** 大小写不敏感地高亮句中的目标词（供其他页面复用） */
export function Highlighted({ sentence, word }: { sentence: string; word: string }) {
  const idx = word ? sentence.toLowerCase().indexOf(word.toLowerCase()) : -1;
  if (idx < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 font-semibold text-slate-800">
        {sentence.slice(idx, idx + word.length)}
      </mark>
      {sentence.slice(idx + word.length)}
    </>
  );
}
