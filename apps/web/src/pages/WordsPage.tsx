import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeStage } from '@app/core';
import { api } from '../lib/api';
import type { MyWordItem, MyWordsResponse } from '../lib/types';
import SpeakerButton from '../components/SpeakerButton';
import { Highlighted } from '../components/ExampleSentence';

type Filter = 'all' | 'learning' | 'due' | 'graduated';
type Sort = 'recent' | 'stage' | 'alpha';

const FILTER_TABS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'learning', label: '🌱 学手中' },
  { key: 'due', label: '🔁 待复习' },
  { key: 'graduated', label: '🎓 已毕业' },
];

/** 📚 我的词库：所有已学单词 + 艾宾浩斯记忆进度 */
export default function WordsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MyWordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.myWords({ filter, sort, page, pageSize });
      setData(res);
    } catch {
      /* 静默：保留上次数据 */
    } finally {
      setLoading(false);
    }
  }, [filter, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">我的词库</h1>
        <Link to="/today" className="text-xs font-medium text-blue-600 hover:underline">
          去学习 →
        </Link>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <StatCard label="已学" value={data?.total ?? '—'} cls="text-slate-800" />
        <StatCard label="🔁 待复习" value={data?.due ?? '—'} cls="text-orange-500" />
        <StatCard label="🌱 学手中" value={data?.learning ?? '—'} cls="text-blue-500" />
        <StatCard label="🎓 已毕业" value={data?.graduated ?? '—'} cls="text-emerald-500" />
      </div>

      {/* 筛选 Tab */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setFilter(t.key);
              setPage(1);
            }}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === t.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            setPage(1);
          }}
          className="ml-auto rounded-full bg-white px-2 py-1.5 text-xs text-slate-500 outline-none"
        >
          <option value="recent">最近作答</option>
          <option value="stage">按级别</option>
          <option value="alpha">按字母</option>
        </select>
      </div>

      {/* 列表 */}
      {loading && !data ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/70" />
          ))}
        </div>
      ) : (data?.items.length ?? 0) === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow">
          <p className="text-4xl">📭</p>
          <p className="mt-3 text-sm text-slate-400">
            {filter === 'all' ? '还没学过单词，去今日学习开荒吧！' : '这个分类下暂时没有词'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {data!.items.map((item) => (
            <WordRow key={item.wordId} item={item} />
          ))}
        </ul>
      )}

      {/* 分页 */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-2 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg bg-white px-4 py-2 shadow disabled:opacity-30"
          >
            ← 上一页
          </button>
          <span className="text-xs text-slate-400">
            {page} / {data.pages}
          </span>
          <button
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg bg-white px-4 py-2 shadow disabled:opacity-30"
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}

function WordRow({ item }: { item: MyWordItem }) {
  const stage = item.stage ?? 0;
  const graduated = item.status === 'graduated';

  return (
    <li className="flex items-center gap-3 rounded-xl bg-white p-3.5 shadow">
      {/* 左：词与释义 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-slate-800">{item.text}</p>
          <SpeakerButton text={item.text} className="!h-6 !w-6 shrink-0 !text-xs" />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400">
          {item.phonetic && <span className="mr-1.5 font-mono text-[11px] text-slate-300">{item.phonetic}</span>}
          {item.definitions.map((d) => d.meaning).join('；')}
        </p>
        {item.example && (
          <>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              📖 <Highlighted sentence={item.example} word={item.text} />
            </p>
            {item.exampleZh && (
              <p className="text-[10px] leading-relaxed text-slate-300">{item.exampleZh}</p>
            )}
          </>
        )}
        <p className="mt-1 text-[10px] text-slate-300">
          作答 {item.reps} 次{item.lapses > 0 ? ` · 遗忘 ${item.lapses} 次` : ''}
        </p>
      </div>

      {/* 右：艾宾浩斯进度 + 状态 */}
      <div className="shrink-0 text-right">
        <StageBar stage={stage} graduated={graduated} />
        <StatusChip item={item} />
      </div>
    </li>
  );
}

/** 10 格进度条（第0级→毕业） */
function StageBar({ stage, graduated }: { stage: number; graduated: boolean }) {
  return (
    <div className="flex items-center justify-end gap-[3px]">
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-full ${
            graduated || i < stage
              ? i < 3
                ? 'bg-emerald-300'
                : i < 6
                  ? 'bg-blue-400'
                  : 'bg-indigo-500'
              : 'bg-slate-200'
          }`}
        />
      ))}
    </div>
  );
}

function StatusChip({ item }: { item: MyWordItem }) {
  let text: string;
  let cls: string;
  if (item.status === 'graduated') {
    text = '🎓 已毕业';
    cls = 'text-emerald-600';
  } else if (item.status === 'due') {
    text = '🔁 该复习了';
    cls = 'text-orange-500 font-semibold';
  } else {
    const dueText = item.dueAt
      ? new Date(item.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '';
    text = `${describeStage(item.stage ?? 0)}${dueText ? ` · ${dueText}` : ''}`;
    cls = 'text-slate-400';
  }
  return <p className={`mt-1 text-[11px] ${cls}`}>{text}</p>;
}

function StatCard({ label, value, cls }: { label: string; value: number | string; cls: string }) {
  return (
    <div className="rounded-xl bg-white py-3 shadow-sm">
      <p className={`text-xl font-extrabold ${cls}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{label}</p>
    </div>
  );
}
