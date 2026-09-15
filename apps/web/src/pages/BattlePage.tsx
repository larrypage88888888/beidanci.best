import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { BattleAnswerResponse, BattleBoss, BattleQuestion, BattleStartResponse, BossesResponse } from '../lib/types';
import SpeakerButton from '../components/SpeakerButton';
import ExampleSentence from '../components/ExampleSentence';
import { playCorrect, playWrong, playDraw } from '../lib/sfx';

const RARITY_STYLE: Record<string, string> = {
  SR: 'bg-blue-100 text-blue-600',
  SSR: 'bg-fuchsia-100 text-fuchsia-600',
  UR: 'bg-gradient-to-r from-amber-300 to-orange-400 text-white',
};

type Phase = 'loading' | 'list' | 'fight' | 'done';

/** ⚔️ 卡牌对战：词灵 BOSS 战 —— 答对出招、答错挨打，玩着玩着就复习了 */
export default function BattlePage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [bosses, setBosses] = useState<BossesResponse | null>(null);
  const [battle, setBattle] = useState<BattleStartResponse | null>(null);
  const [q, setQ] = useState<BattleQuestion | null>(null);
  const [combo, setCombo] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [playerHp, setPlayerHp] = useState(5);
  const [bossHp, setBossHp] = useState(12);
  const [anim, setAnim] = useState<{ kind: 'hit' | 'hurt'; damage: number } | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [result, setResult] = useState<BattleAnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void api
      .battleBosses()
      .then((b) => {
        setBosses(b);
        setPhase('list');
      })
      .catch((e) => setNotice(e instanceof Error ? e.message : '加载失败'));
  }, []);

  async function start(boss: BattleBoss) {
    setNotice(null);
    setBusy(true);
    try {
      const b = await api.battleStart(boss.id);
      setBattle(b);
      setQ(b.question);
      setCombo(0);
      setAnswered(0);
      setPlayerHp(b.playerHp);
      setBossHp(b.bossHp);
      setAnim(null);
      setReveal(null);
      setResult(null);
      setPhase('fight');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '开战失败');
    } finally {
      setBusy(false);
    }
  }

  async function answer(picked?: string, typed?: string) {
    if (!battle || busy) return;
    setBusy(true);
    setReveal(null);
    try {
      const r = await api.battleAnswer(battle.battleId, picked !== undefined ? { picked } : { typed });
      setCombo(r.combo);
      setAnswered(r.answered);
      setPlayerHp(r.playerHp);
      setBossHp(r.bossHp);
      if (r.finished) {
        // 结算动画后进入结果页
        setAnim(r.win ? { kind: 'hit', damage: r.damage } : { kind: 'hurt', damage: 1 });
        if (r.win) playDraw();
        else playWrong();
        setTimeout(() => {
          setResult(r);
          setPhase('done');
        }, 650);
        return;
      }
      if (r.correct) {
        playCorrect(r.combo);
        setAnim({ kind: 'hit', damage: r.damage });
      } else {
        playWrong();
        setAnim({ kind: 'hurt', damage: 1 });
        setReveal(r.reveal);
      }
      setTimeout(() => {
        setAnim(null);
        setQ(r.next);
      }, 750);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '作答失败');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-2xl bg-white shadow" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-white shadow" />
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return <ResultView result={result} onAgain={() => setPhase('list')} bossName={battle?.boss.name} bossEmoji={battle?.boss.emoji} />;
  }

  if (phase === 'fight' && battle && q) {
    const bossMax = battle.boss.hp;
    const hpPct = Math.max(0, Math.min(100, (bossHp / bossMax) * 100));
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-800">⚔️ BOSS 战</h1>
          <span className="text-xs text-slate-400">
            {answered}/{battle.total} · 🔥连击 <b className="text-orange-500">{combo}</b>
          </span>
        </div>

        {/* BOSS 血条 */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700">
              {battle.boss.emoji} {battle.boss.name}
            </p>
            <p className="text-xs text-slate-400">
              剩余 <b className="text-red-500">{Math.max(0, bossHp)}</b>/{bossMax}
            </p>
          </div>
          <div className="relative mt-2 h-3.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-500 transition-all duration-500"
              style={{ width: `${hpPct}%` }}
            />
            {anim?.kind === 'hit' && (
              <span className="wf-dmg absolute right-2 top-0 text-sm font-black text-orange-500">
                -{anim.damage}
              </span>
            )}
          </div>
        </div>

        {/* 玩家血条 */}
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 shadow-sm">
          <span className="text-base">🛡️</span>
          <div className="flex-1">
            <div className="flex gap-1">
              {Array.from({ length: playerHp }).map((_, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${anim?.kind === 'hurt' ? 'bg-red-500' : 'bg-emerald-500'}`} />
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">答错会被 BOSS 反击扣血 · 答对连击加伤害</p>
          </div>
          <span className="text-xs font-bold text-slate-600">{playerHp}</span>
        </div>

        {/* 题目卡 */}
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
          <BattleQuestionCard key={q.id} question={q} busy={busy} onSubmit={answer} reveal={reveal} />
        </div>

        {notice && <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-600">{notice}</p>}
      </div>
    );
  }

  // ── BOSS 列表 ──
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">⚔️ 卡牌对战</h1>
        {bosses && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-600">
            今日胜 {bosses.battleWinsToday}/3
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        用背单词当出招：答对攻击 BOSS（连击伤害递增），答错被反击扣血。每天每个 BOSS 可挑战一次，击败得词力积分 +
        抽卡次数 + 限定词卡。
      </p>

      <div className="space-y-3">
        {bosses?.bosses.map((b) => {
          const canFight = !b.playedToday;
          return (
            <div
              key={b.id}
              className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ${
                b.wonToday ? 'ring-emerald-200' : 'ring-slate-100'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-4xl">{b.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-800">
                    {b.name}
                    <span className="ml-2 text-[10px] font-normal text-slate-400">
                      难度 {Array.from({ length: b.difficulty }).map((_, i) => '⭐').join('')}
                    </span>
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">{b.description}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${RARITY_STYLE[b.rewardRarity]}`}>
                  {b.rewardRarity}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                <span>❤️ BOSS 血 {b.hp}</span>
                <span>💎 胜 +{b.rewardPoints} 词力</span>
              </div>

              {b.wonToday ? (
                <p className="mt-3 rounded-xl bg-emerald-50 py-2 text-center text-xs font-medium text-emerald-600">
                  ✅ 今日已击败 · 明日再来
                </p>
              ) : canFight ? (
                <button
                  onClick={() => void start(b)}
                  disabled={busy}
                  className="mt-3 w-full rounded-xl bg-gradient-to-r from-red-500 to-rose-500 py-2.5 font-bold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy ? '开战中…' : '⚔️ 挑战'}
                </button>
              ) : (
                <p className="mt-3 rounded-xl bg-slate-50 py-2 text-center text-xs font-medium text-slate-400">
                  今日已挑战 · 明天再来
                </p>
              )}
            </div>
          );
        })}
      </div>

      {notice && <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-600">{notice}</p>}
      <p className="pb-2 text-center text-[11px] text-slate-300">
        对战作答会计入今日学习进度（浇灌词苗 / 抽卡门槛）
      </p>
    </div>
  );
}

/** 对战中的题目卡片：服务端判定，提交选择/拼写 */
function BattleQuestionCard({
  question,
  busy,
  onSubmit,
  reveal,
}: {
  question: BattleQuestion;
  busy: boolean;
  onSubmit: (picked?: string, typed?: string) => void;
  reveal: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  if (question.kind === 'spell') {
    return (
      <div>
        <div className="mb-5 text-center">
          <p className="mx-auto max-w-md px-2 text-lg leading-relaxed text-slate-700">{question.prompt}</p>
          {!reveal && <p className="mt-3 font-mono text-xl tracking-[0.35em] text-slate-300">{question.hint}</p>}
          {reveal && (
            <p className="mt-3 text-3xl font-bold tracking-wider text-emerald-600">{reveal}</p>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !typed.trim() || reveal) return;
            onSubmit(undefined, typed);
          }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="输入英文单词"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={busy || !!reveal}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-lg outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={busy || !typed.trim() || !!reveal}
            className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:opacity-40"
          >
            出招!
          </button>
        </form>
        {question.example && (
          <div className="mt-4 text-left">
            <ExampleSentence sentence={question.example} zh={question.exampleZh} word={question.wordText} />
          </div>
        )}
      </div>
    );
  }

  const isWordChoice = question.kind === 'word-choice';
  return (
    <div>
      <div className="mb-5 text-center">
        {isWordChoice ? (
          <p className="mx-auto max-w-md px-2 text-lg leading-relaxed text-slate-700">{question.prompt}</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-2">
              <p className="text-4xl font-bold tracking-wide text-slate-800">{question.wordText}</p>
              <SpeakerButton text={question.wordText} />
            </div>
            {question.phonetic && <p className="mt-2 font-mono text-sm text-slate-400">{question.phonetic}</p>}
          </>
        )}
        <p className="mt-2 text-xs text-slate-400">{isWordChoice ? '选择对应的单词' : '选择正确的释义'}</p>
      </div>

      <div className={`grid gap-2.5 ${isWordChoice ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {question.options?.map((o) => {
          let cls = 'border-slate-200 bg-white hover:border-blue-300';
          if (picked) {
            if (o.key === picked) cls = 'border-blue-300 bg-blue-50';
            else cls = 'border-slate-200 bg-white opacity-50';
          }
          return (
            <button
              key={o.key}
              onClick={() => {
                if (busy || picked) return;
                setPicked(o.key);
                onSubmit(o.key);
              }}
              disabled={busy || !!picked}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${cls}`}
            >
              {!isWordChoice && <span className="font-bold text-slate-400">{o.key}</span>}
              <span className="text-slate-700">{o.text}</span>
            </button>
          );
        })}
      </div>

      {reveal && (
        <p className="mt-3 text-center text-sm font-medium text-red-500">
          正确答案：<b className="text-emerald-600">{reveal}</b>
        </p>
      )}
    </div>
  );
}

/** 结算页 */
function ResultView({
  result,
  onAgain,
  bossName,
  bossEmoji,
}: {
  result: BattleAnswerResponse;
  onAgain: () => void;
  bossName?: string;
  bossEmoji?: string | null;
}) {
  const win = result.win ?? result.result === 'win';
  const card = result.reward?.card;
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="wf-card-in rounded-2xl bg-white p-7 text-center shadow-lg">
        <p className="text-6xl">{win ? '🏆' : '💥'}</p>
        <h2 className="mt-3 text-xl font-bold text-slate-800">
          {win ? `击败了 ${bossEmoji} ${bossName}！` : `惜败 ${bossEmoji} ${bossName}`}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          对 {result.correctCount}/{result.total} 题 · 剩余 ❤️ {result.playerHp}
        </p>

        <div className="mt-6 space-y-2.5 text-left">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">💎 词力积分</span>
            <span className="font-bold text-amber-600">+{result.reward?.points ?? 0}</span>
          </div>
          {win && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-600">🎴 限定词卡</span>
              {card && !card.duplicate ? (
                <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-bold text-fuchsia-600">
                  {card.rarity} 掉落！
                </span>
              ) : card?.duplicate ? (
                <span className="text-xs font-bold text-amber-600">重复 → 已转 +{card.pointsGained} 词力</span>
              ) : (
                <span className="text-xs text-slate-400">未掉落</span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">🎯 抽卡次数</span>
            <span className="font-bold text-blue-600">{win ? '+1（今日 BOSS 胜利加成）' : '—'}</span>
          </div>
        </div>

        {card && !card.duplicate && card.wordId && (
          <div className="mt-5 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 p-5 text-white shadow">
            <p className="text-[10px] tracking-widest opacity-80">{card.rarity} 限定词卡</p>
            <p className="mt-2 text-2xl font-extrabold">{card.wordId}</p>
          </div>
        )}

        <div className="mt-6 flex gap-2.5">
          <Link
            to="/cards"
            className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
          >
            🃏 看图鉴
          </Link>
          <button
            onClick={onAgain}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            ⚔️ 再战
          </button>
        </div>
      </div>
    </div>
  );
}
