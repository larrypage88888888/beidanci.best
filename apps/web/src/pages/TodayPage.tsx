import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeStage } from '@app/core';
import { useSessionStore } from '../stores/session';
import { useAuthStore } from '../stores/auth';
import MeaningChoice from '../components/quiz/MeaningChoice';
import WordChoice from '../components/quiz/WordChoice';
import SpellCard from '../components/quiz/SpellCard';
import SpeakerButton from '../components/SpeakerButton';
import ExampleSentence, { Highlighted } from '../components/ExampleSentence';
import { autoSpeak, autoSpeakSequence } from '../lib/speech';
import type { TodayItem } from '../lib/types';

/** 今日学习：题型轮换 + 乐观调度 + 批量回写 */
export default function TodayPage() {
  const s = useSessionStore();
  const refreshMe = useAuthStore((st) => st.refreshMe);

  useEffect(() => {
    if (s.phase === 'idle') void s.loadToday();
  }, [s.phase, s.loadToday]);

  const q = s.questions[s.idx];
  const total = s.questions.length;
  const progressPct = total === 0 ? 100 : (s.idx / total) * 100;
  const currentWord = q ? s.items.get(q.wordId) : undefined;

  // 剩余题里的复习/新词构成
  const counts = useMemo(() => {
    let review = 0;
    let fresh = 0;
    for (let i = s.idx; i < s.questions.length; i++) {
      const entry = s.items.get(s.questions[i].wordId)?.entry;
      if (entry === 'review') review += 1;
      else fresh += 1;
    }
    return { review, fresh };
  }, [s.questions, s.idx, s.items]);

  // 答题期间禁止重复点击
  const [locked, setLocked] = useState(false);
  useEffect(() => setLocked(s.phase === 'submitting'), [s.phase]);

  // 完成页轮询：艾宾浩斯到点（5 分钟快闪 / 30 分钟二轮…）自动续上新一轮
  useEffect(() => {
    if (s.phase !== 'done') return;
    const timer = setInterval(() => {
      void s.refreshQueue();
    }, 45_000);
    return () => clearInterval(timer);
  }, [s.phase, s.refreshQueue]);

  // 网络恢复时立即补交未回写的作答
  useEffect(() => {
    const onOnline = () => void s.skipFlush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [s.skipFlush]);

  async function handlePick(correct: boolean) {
    setLocked(true);
    await s.answer(correct ? 'remembered' : 'forgot');
    setLocked(false);
  }

  async function handleSpellRate(rating: 'remembered' | 'fuzzy' | 'forgot') {
    setLocked(true);
    await s.answer(rating);
    setLocked(false);
  }

  /* ---------- 完成页 ---------- */
  if (s.phase === 'done' && !q) {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="wf-card-in rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="text-5xl">🎉</p>
          <h2 className="mt-3 text-xl font-bold text-slate-800">今日词流完成！</h2>
          <div className="mt-6 grid grid-cols-3 gap-2 text-center">
            <Metric label="记得" value={s.summary.remembered} cls="text-emerald-500" />
            <Metric label="模糊" value={s.summary.fuzzy} cls="text-amber-500" />
            <Metric label="忘记" value={s.summary.forgot} cls="text-red-400" />
          </div>
          <p className="mt-4 text-sm text-slate-500">
            🔥 连续打卡 <b className="text-orange-500">{s.streak}</b> 天 · 毕业了{' '}
            <b className="text-emerald-500">{s.summary.graduated}</b> 个词 🎓
          </p>

          {s.buffer.length > 0 && (
            <p className="mt-3 text-xs text-amber-500">
              有 {s.buffer.length} 条作答待同步，网络恢复后会自动回传
            </p>
          )}

          <p className="mt-4 rounded-xl bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-500">
            ⚡ 艾宾浩斯快闪：刚学的词 5 分钟后会回来考你，然后 30 分钟、12 小时、1 天……
            <br />
            本页每 45 秒自动检测，也可以手动检查：
          </p>
          <button
            onClick={() => void s.refreshQueue()}
            className="mt-2 w-full rounded-xl border border-blue-200 bg-white py-2.5 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
          >
            ⚡ 检查到期的快闪复习
          </button>

          <Link
            to="/stats"
            className="mt-3 block w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            查看学习统计 →
          </Link>
          <button onClick={() => void refreshMe()} className="mt-3 text-xs text-slate-400 hover:text-slate-600">
            刷新账号数据
          </button>
        </div>
      </div>
    );
  }

  /* ---------- 预习词卡：学习前先过一遍所有单词 ---------- */
  if (s.phase === 'preview') {
    const item = s.items.get(s.previewIds[0] ?? '');
    if (!item) {
      return (
        <div className="mx-auto max-w-md px-4 py-8">
          <button onClick={() => s.skipPreview()} className="text-sm text-blue-600">继续 →</button>
        </div>
      );
    }
    const doneCount = total - s.previewIds.length;
    return (
      <PreviewCard
        item={item}
        index={doneCount + 1}
        total={total}
        isLast={s.previewIds.length === 1}
        onNext={() => s.advancePreview()}
        onSkip={() => s.skipPreview()}
      />
    );
  }

  /* ---------- 错词重学：学习卡片 ---------- */
  if (s.phase === 'relearn') {
    const item = s.items.get(s.relearnQueue[0] ?? '');
    if (!item) {
      // 队列异常兜底
      return (
        <div className="mx-auto max-w-md px-4 py-8">
          <button onClick={() => s.acceptRelearn()} className="text-sm text-blue-600">继续 →</button>
        </div>
      );
    }
    return <RelearnCard item={item} remaining={s.relearnQueue.length} attempt={s.relearnAttempts[item.id] ?? 0} onAccept={() => s.acceptRelearn()} />;
  }

  /* ---------- 加载 / 错误 ---------- */
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      {/* 头部进度 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
            今日学习
            {s.inRelearnRound && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-600">
                🔁 错词重学
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-400">
            剩余 {Math.max(0, total - s.idx)} 题 ·{' '}
            <span className="text-orange-500">🔁 复习 {counts.review}</span> ·{' '}
            <span className="text-emerald-600">🌱 新词 {counts.fresh}</span>
          </p>
        </div>
        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-600">🔥 {s.streak}</span>
      </div>
      <div className="mb-8 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all" style={{ width: `${progressPct}%` }} />
      </div>

      {s.error && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-600">
          {s.error}
          <button className="ml-2 underline" onClick={() => void s.skipFlush()}>
            立即重试
          </button>
        </p>
      )}

      {/* 题卡 */}
      {s.phase === 'loading' && <SkeletonCard />}

      {!q && s.phase !== 'loading' && (
        <div className="rounded-2xl bg-white p-10 text-center shadow">
          <p className="text-4xl">{s.error ? '😵' : '🌱'}</p>
          <p className="mt-3 text-sm text-slate-500">{s.error ?? '今天的队列空空如也'}</p>
          {s.error?.includes('重新') && (
            <p className="mt-2 text-xs text-slate-300">即将自动返回登录页，重新注册即可继续</p>
          )}
          <button
            onClick={() => void s.loadToday()}
            className="mt-4 rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600"
          >
            刷新试试
          </button>
        </div>
      )}

      {q && (
        <div key={`${q.wordId}:${s.idx}`} className="wf-card-in rounded-2xl bg-white p-6 shadow-lg sm:p-8">
          {/* 来源徽章 + 题型 */}
          <div className="mb-4 flex items-center justify-between text-[11px] font-medium">
            <div className="flex items-center gap-1.5">
              {currentWord?.entry === 'review' ? (
                <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-600">
                  🔁 复习{currentWord.reviewStage != null ? ` · ${describeStage(currentWord.reviewStage)}` : ''}
                </span>
              ) : (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700">🌱 新词</span>
              )}
              <KindBadge kind={q.kind} />
            </div>
            {currentWord?.cefr && <span className="text-slate-300">CEFR {currentWord.cefr}</span>}
          </div>

          {q.kind === 'meaning-choice' && <MeaningChoice question={q} locked={locked} onPick={(c) => void handlePick(c)} />}
          {q.kind === 'word-choice' && <WordChoice question={q} locked={locked} onPick={(c) => void handlePick(c)} />}
          {q.kind === 'spell' && <SpellCard question={q} locked={locked} onRate={(r) => void handleSpellRate(r)} />}
        </div>
      )}

      {/* 当前词的调度预览（乐观镜像，服务端确认后校正） */}
      {q && s.mirror[q.wordId] && (
        <p className="mt-3 text-center text-[11px] text-slate-300">
          下次复习：<SchedulePreview wordId={q.wordId} />
        </p>
      )}
    </div>
  );
}

function SchedulePreview({ wordId }: { wordId: string }) {
  const state = useSessionStore((st) => st.mirror[wordId]);
  if (!state) return null;
  if (!state.dueAt) return <span>已毕业 🎓</span>;
  if (state.stage != null) return <span>{describeStage(state.stage)}</span>;
  return <span>{new Date(state.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })}</span>;
}

/** 预习词卡：单词 → 音标 → 释义 → 例句；自动连播单词与例句读音 */
function PreviewCard({
  item,
  index,
  total,
  isLast,
  onNext,
  onSkip,
}: {
  item: TodayItem;
  index: number;
  total: number;
  isLast: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  // 卡片出现即自动播放：先读单词，读完接例句
  useEffect(() => {
    autoSpeakSequence([item.text, item.example].filter(Boolean) as string[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          🎬 预习词卡
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
            {index} / {total}
          </span>
        </h1>
        <button onClick={onSkip} className="text-xs text-slate-400 hover:text-slate-600">
          跳过预习
        </button>
      </div>

      {/* 进度条 */}
      <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>

      <div className="wf-card-in rounded-2xl bg-white p-8 shadow-lg" key={item.id}>
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <p className="text-4xl font-bold tracking-wide text-slate-800">{item.text}</p>
            <SpeakerButton text={item.text} />
          </div>
          {item.phonetic && <p className="mt-2 font-mono text-sm text-slate-400">{item.phonetic}</p>}
          {item.cefr && <p className="mt-1 text-[11px] text-slate-300">CEFR {item.cefr}</p>}
        </div>

        <div className="my-5 border-t border-dashed border-slate-200" />

        {/* 释义 */}
        <ul className="space-y-2.5">
          {item.definitions.map((d, i) => (
            <li key={i} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              {d.pos && <span className="mr-2 font-bold text-blue-500">{d.pos}</span>}
              <span className="text-slate-700">{d.meaning}</span>
            </li>
          ))}
        </ul>

        {/* 例句（含高亮与整句朗读） */}
        {item.example && (
          <ExampleSentence sentence={item.example} zh={item.exampleZh} word={item.text} />
        )}

        <p className="mt-6 text-center text-xs text-slate-300">看好了？马上开始做题 👇</p>
        <button
          onClick={onNext}
          className="mt-3 w-full rounded-xl bg-blue-600 py-3.5 font-medium text-white transition hover:bg-blue-700"
        >
          {isLast ? '💪 开始做题' : '下一个 →'}
        </button>
        {isLast && (
          <p className="mt-2 text-center text-[11px] text-slate-300">
            这是最后一张词卡，共 {total} 个词
          </p>
        )}
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  const label = useMemo(
    () => ({ 'meaning-choice': '看词选义', 'word-choice': '看义选词', spell: '拼写默写' })[kind] ?? kind,
    [kind],
  );
  return <span className="rounded bg-slate-100 px-2 py-0.5">{label}</span>;
}

/** 错词重学卡片：看词 → 听音 → 读释义，再点按钮生成新题巩固；反复错就反复学 */
function RelearnCard({
  item,
  remaining,
  attempt,
  onAccept,
}: {
  item: TodayItem;
  remaining: number;
  /** 该词此前已被重考的次数（0=首次重学） */
  attempt: number;
  onAccept: () => void;
}) {
  // 卡片出现即朗读
  useEffect(() => {
    autoSpeak(item.text);
  }, [item.id]);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          🔁 错词重学
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-600">
            还剩 {remaining} 个
          </span>
          {attempt > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-500">
              第 {attempt + 1} 遍
            </span>
          )}
        </h1>
        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-bold text-orange-600">🔥</span>
      </div>

      <div className="wf-card-in rounded-2xl bg-white p-8 shadow-lg" key={item.id}>
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <p className="text-4xl font-bold tracking-wide text-slate-800">{item.text}</p>
            <SpeakerButton text={item.text} />
          </div>
          {item.phonetic && <p className="mt-2 font-mono text-sm text-slate-400">{item.phonetic}</p>}
          {item.cefr && <p className="mt-1 text-[11px] text-slate-300">CEFR {item.cefr}</p>}
        </div>

        <div className="my-6 border-t border-dashed border-slate-200" />

        {/* 释义逐条展示 */}
        <ul className="space-y-2.5">
          {item.definitions.map((d, i) => (
            <li key={i} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
              {d.pos && <span className="mr-2 font-bold text-blue-500">{d.pos}</span>}
              <span className="text-slate-700">{d.meaning}</span>
            </li>
          ))}
        </ul>

        {/* 例句巩固语境记忆 */}
        {item.example && (
          <ExampleSentence sentence={item.example} zh={item.exampleZh} word={item.text} />
        )}

        <p className="mt-6 text-center text-xs text-slate-300">多看一眼，马上考你 👇</p>
        <button
          onClick={onAccept}
          className="mt-3 w-full rounded-xl bg-blue-600 py-3.5 font-medium text-white transition hover:bg-blue-700"
        >
          💪 我记住了，出题考我
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-3">
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl bg-white p-8 shadow-lg">
      <div className="mx-auto h-8 w-40 rounded bg-slate-200" />
      <div className="mt-10 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-xl bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
