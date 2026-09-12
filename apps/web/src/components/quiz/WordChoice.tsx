import { useEffect, useState } from 'react';
import type { QuizQuestion } from '@app/core';
import { autoSpeak } from '../../lib/speech';
import SpeakerButton from '../SpeakerButton';
import ExampleSentence from '../ExampleSentence';

/**
 * 题型二：看义选词（释义 → 单词四选一）。
 * 单词即答案：作答前不出声音；作答后揭示答案并朗读强化记忆。
 */
export default function WordChoice({
  question,
  locked,
  onPick,
}: {
  question: QuizQuestion;
  locked: boolean;
  onPick: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const answerText = question.options?.find((o) => o.key === question.answerKey)?.text ?? '';

  // 作答后朗读正确答案（听一遍拼写与发音的联结）
  useEffect(() => {
    if (picked) autoSpeak(answerText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  function choose(key: string) {
    if (locked || picked) return;
    setPicked(key);
    const correct = key === question.answerKey;
    setTimeout(() => onPick(correct), 850);
  }

  return (
    <div>
      {/* 题干：释义 */}
      <div className="mb-6 text-center">
        <p className="mx-auto max-w-md px-2 text-lg leading-relaxed text-slate-700">{question.prompt}</p>
        <p className="mt-2 text-xs text-slate-400">选择对应的单词</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {question.options?.map((o) => {
          const isAnswer = o.key === question.answerKey;
          const isPicked = o.key === picked;
          let cls = 'border-slate-200 bg-white hover:border-blue-300';
          if (picked) {
            if (isAnswer) cls = 'border-emerald-400 bg-emerald-50';
            else if (isPicked) cls = 'border-red-300 bg-red-50';
            else cls = 'border-slate-200 bg-white opacity-50';
          }
          return (
            <button
              key={o.key}
              onClick={() => choose(o.key)}
              disabled={!!picked}
              className={`rounded-xl border px-4 py-3.5 text-base font-semibold transition ${cls}`}
            >
              {o.text}
              {picked && isAnswer && <span className="ml-1">✅</span>}
              {picked && isPicked && !isAnswer && <span className="ml-1">❌</span>}
            </button>
          );
        })}
      </div>

      {/* 揭示答案 + 发音 + 例句（作答前例句含答案，绝不展示） */}
      {picked != null && (
        <>
          <div className="mt-4 flex items-center justify-center gap-2">
            <p className="text-lg font-bold text-slate-800">{answerText}</p>
            {question.phonetic && <p className="font-mono text-xs text-slate-400">{question.phonetic}</p>}
            <SpeakerButton text={answerText} />
          </div>
          {question.example && (
            <div className="text-left">
              <ExampleSentence sentence={question.example} zh={question.exampleZh} word={answerText} />
            </div>
          )}
        </>
      )}

      {/* 答对后的正向反馈彩蛋 */}
      {picked === question.answerKey && (
        <p className="mt-2 text-center text-sm font-medium text-emerald-500">答对了，这个词升一级 ⬆️</p>
      )}
    </div>
  );
}
