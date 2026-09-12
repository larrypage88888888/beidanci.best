import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import type { PlacementQuestion, PlacementResult } from '../lib/types';

/**
 * 自适应摸底测试（约 20 题，2 分钟）：
 * 服务端按你的作答实时调整难度，二分收敛出词汇量与初始等级。
 */
export default function PlacementPage() {
  const [question, setQuestion] = useState<PlacementQuestion | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 1, total: 20 });
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // 摸底完成时同步本地缓存，否则路由守卫会拿旧的 placementDone=false 把人弹回来
  const cachedUser = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    try {
      // 以服务端为准：已完成摸底的用户直接放行（也兜底修复本地缓存过期的旧会话）
      const me = await api.me().catch(() => null);
      if (me?.user?.placementDone) {
        navigate('/today', { replace: true });
        return;
      }
      const res = await api.placementStart();
      setQuestion(res.question);
      setToken(res.sessionToken);
      setProgress(res.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, [navigate]);

  useEffect(() => {
    void start();
  }, [start]);

  async function answer(correct: boolean) {
    if (!question || !token) return;
    try {
      const res = await api.placementAnswer(token, question.wordId, correct);
      if (res.done) {
        setResult(res.result);
        // 关键：同步本地用户缓存（服务端已置 placement_done=1 并写入新等级）
        if (cachedUser) {
          setUser({ ...cachedUser, placementDone: true, level: res.result.level });
        }
      } else {
        setQuestion(res.question);
        setToken(res.sessionToken);
        setProgress(res.progress);
      }
    } catch (err) {
      // 会话过期等情况：自动重新开始
      if (err instanceof Error && /会话/.test(err.message)) {
        await start();
        return;
      }
      setError(err instanceof Error ? err.message : '提交失败');
    }
  }

  /* ---------- 结果页 ---------- */
  if (result) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-12">
        <div className="wf-card-in w-full rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="text-5xl">🎯</p>
          <h2 className="mt-3 text-xl font-bold text-slate-800">摸底完成！</h2>
          <div className="mt-6 space-y-3 text-left">
            <Row label="预估词汇量" value={`${result.vocabEstimate.toLocaleString()} 词`} accent />
            <Row label="当前等级" value={result.cefr} />
            <Row label="正确率" value={` ${result.correctCount}/${result.questionCount}`} />
          </div>
          <button
            onClick={() => navigate('/today')}
            className="mt-8 w-full rounded-xl bg-blue-600 py-3 font-medium text-white transition hover:bg-blue-700"
          >
            开始今天的词流 →
          </button>
        </div>
      </div>
    );
  }

  /* ---------- 答题页 ---------- */
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-slate-800">先摸个底</h2>
        <p className="mt-1 text-xs text-slate-400">认识就点认识，不认识也别猜 —— 这不是考试 😄</p>
      </div>

      {/* 进度条 */}
      <div className="mb-8 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${(progress.current / progress.total) * 100}%` }}
        />
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-center text-sm text-red-500">{error}</p>}

      {question ? (
        <div key={question.wordId} className="wf-card-in rounded-2xl bg-white p-8 shadow-lg">
          <p className="text-center text-4xl font-bold tracking-wide">{question.text}</p>
          <div className="mt-10 grid grid-cols-2 gap-3">
            <button
              onClick={() => answer(false)}
              className="rounded-xl bg-slate-100 py-4 text-base font-medium text-slate-600 transition hover:bg-slate-200"
            >
              🙈 不认识
            </button>
            <button
              onClick={() => answer(true)}
              className="rounded-xl bg-blue-600 py-4 text-base font-medium text-white transition hover:bg-blue-700"
            >
              💪 认识
            </button>
          </div>
        </div>
      ) : (
        !error && <p className="text-center text-sm text-slate-400">正在出题…</p>
      )}

      <p className="mt-6 text-center text-[11px] text-slate-300">
        第 {progress.current} / {progress.total} 题 · 全程约 2 分钟
      </p>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`font-bold ${accent ? 'text-blue-600' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}
