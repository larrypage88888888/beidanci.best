import { useEffect, useState } from 'react';
import type { QuizQuestion } from '@app/core';
import { autoSpeak } from '../../lib/speech';
import SpeakerButton from '../SpeakerButton';
import ExampleSentence from '../ExampleSentence';

/** 题型一：看词选义（word → 释义四选一）。单词直接可见：出题即自动朗读 */
export default function MeaningChoice({
  question,
  locked,
  onPick,
}: {
  question: QuizQuestion;
  locked: boolean;
  onPick: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // 本题型的题干就是单词，工厂恒填 wordText；此处仅作类型兜底
  const word = question.wordText ?? '';

  // 换题即朗读（单词可见，无泄题风险）
  useEffect(() => {
    setPicked(null);
    autoSpeak(word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.wordId]);

  function choose(key: string) {
    if (locked || picked) return;
    setPicked(key);
    const correct = key === question.answerKey;
    // 给用户留出看清对错反馈的时间再进入下一题
    setTimeout(() => onPick(correct), 850);
  }

  return (
    <div>
      {/* 题干：单词 */}
      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-4xl font-bold tracking-wide text-slate-800">{word}</p>
          <SpeakerButton text={word} />
        </div>
        {question.phonetic && <p className="mt-2 font-mono text-sm text-slate-400">{question.phonetic}</p>}
        <p className="mt-1 text-xs text-slate-400">选择正确的释义</p>
      </div>

      {/* 选项 */}
      <div className="space-y-2.5">
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
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${cls}`}
            >
              <span className="font-bold text-slate-400">{o.key}</span>
              <span className="text-slate-700">{o.text}</span>
              {picked && isAnswer && <span className="ml-auto">✅</span>}
              {picked && isPicked && !isAnswer && <span className="ml-auto">❌</span>}
            </button>
          );
        })}
      </div>

      {/* 作答后展示例句：先凭记忆选，再用语料验证 */}
      {picked != null && question.example && (
        <ExampleSentence sentence={question.example} zh={question.exampleZh} word={word} />
      )}
    </div>
  );
}
