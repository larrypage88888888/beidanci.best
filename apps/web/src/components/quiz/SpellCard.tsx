import { useEffect, useState } from 'react';
import { checkSpelling, normalizeAnswer, type QuizQuestion } from '@app/core';
import { autoSpeak } from '../../lib/speech';
import SpeakerButton from '../SpeakerButton';
import ExampleSentence from '../ExampleSentence';

/**
 * 题型三：拼写默写（释义 + 字母提示 → 键入单词）。
 * 单词即答案：作答前不发音；判卷后朗读 + 揭示音标，强化音形联结。
 * 拼错时提供「其实想起来了」的改判入口（fuzzy），比纯对错更贴近记忆状态。
 */
export default function SpellCard({
  question,
  locked,
  onRate,
}: {
  question: QuizQuestion;
  locked: boolean;
  /** rating：remembered=拼对；fuzzy=想起来了但拼错；forgot=没想起来 */
  onRate: (rating: 'remembered' | 'fuzzy' | 'forgot') => void;
}) {
  const [input, setInput] = useState('');
  const [checked, setChecked] = useState<'correct' | 'wrong' | null>(null);
  const wordText = question.accept?.[0] ?? question.wordText ?? '';

  // 判卷后自动朗读揭示的单词
  useEffect(() => {
    if (checked) autoSpeak(wordText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  function submit() {
    if (locked || checked || !input.trim()) return;
    const ok = checkSpelling(question, input);
    setChecked(ok ? 'correct' : 'wrong');
    // 稍作停留让发音和正确拼写被看清/听见
    if (ok) setTimeout(() => onRate('remembered'), 1400);
  }

  if (checked === 'wrong') {
    return (
      <div>
        <div className="mb-5 text-center">
          <p className="text-sm text-slate-500">{question.prompt}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <p className="text-3xl font-bold tracking-wider text-emerald-600">{wordText}</p>
            <SpeakerButton text={wordText} />
          </div>
          {question.phonetic && (
            <p className="mt-1 font-mono text-xs text-slate-400">{question.phonetic}</p>
          )}
          <p className="mt-1 text-xs text-red-400">你的答案：{normalizeAnswer(input)}</p>
          {question.example && (
            <ExampleSentence sentence={question.example} zh={question.exampleZh} word={wordText} />
          )}
        </div>
        <div className="space-y-2.5">
          <button
            onClick={() => onRate('fuzzy')}
            className="w-full rounded-xl bg-amber-100 px-4 py-3 font-medium text-amber-700 transition hover:bg-amber-200"
          >
            😅 其实想起来了，只是手滑
          </button>
          <button
            onClick={() => onRate('forgot')}
            className="w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-600 transition hover:bg-red-200"
          >
            🙈 记错了，重新来
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <p className="mx-auto max-w-md px-2 text-lg leading-relaxed text-slate-700">{question.prompt}</p>
        <p className="mt-3 font-mono text-xl tracking-[0.35em] text-slate-300">{question.hint}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-2"
      >
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入英文单词"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={`flex-1 rounded-xl border px-4 py-3 text-lg outline-none transition ${
            checked === 'correct'
              ? 'border-emerald-400 bg-emerald-50'
              : 'border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
          }`}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          提交
        </button>
      </form>

      {/* 拼对：短暂揭示正确拼写、发音与例句再进下一题 */}
      {checked === 'correct' && (
        <div className="mt-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="text-sm font-medium text-emerald-500">✅ {wordText}</p>
            <SpeakerButton text={wordText} className="!h-7 !w-7 !text-sm" />
          </div>
          {question.example && (
            <ExampleSentence sentence={question.example} zh={question.exampleZh} word={wordText} />
          )}
        </div>
      )}
    </div>
  );
}
