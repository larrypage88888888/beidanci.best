import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opponentThreat } from '@app/core';
import { api } from '../lib/api';
import type {
  BattleAnswerResponse,
  BattleBoss,
  BattleQuestion,
  BattleStartResponse,
  BossesResponse,
  HandCard,
} from '../lib/types';
import SpeakerButton from '../components/SpeakerButton';
import ExampleSentence from '../components/ExampleSentence';
import { playCorrect, playWrong, playDraw } from '../lib/sfx';

const RARITY_STYLE: Record<string, string> = {
  SR: 'bg-blue-100 text-blue-600',
  SSR: 'bg-fuchsia-100 text-fuchsia-600',
  UR: 'bg-gradient-to-r from-amber-300 to-orange-400 text-white',
};
const RARITY_BORDER: Record<string, string> = {
  SR: 'border-blue-400',
  SSR: 'border-fuchsia-400',
  UR: 'border-amber-400',
};

type Phase = 'loading' | 'list' | 'fight' | 'done';

/** ⚔️ 炉石式卡牌对战：答对召唤手牌随从出招，答错被对手随从反击 */
export default function BattlePage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [bosses, setBosses] = useState<BossesResponse | null>(null);
  const [battle, setBattle] = useState<BattleStartResponse | null>(null);
  const [q, setQ] = useState<BattleQuestion | null>(null);
  const [hand, setHand] = useState<HandCard[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [heroHp, setHeroHp] = useState(30);
  const [bossHp, setBossHp] = useState(30);
  const [mana, setMana] = useState(0);
  const [combo, setCombo] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [summoned, setSummoned] = useState<HandCard | null>(null);
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
      setHand(b.hand);
      setSelId(null);
      setHeroHp(b.heroHp);
      setBossHp(b.bossHp);
      setMana(b.mana);
      setCombo(0);
      setAnswered(0);
      setSummoned(null);
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

  /** 中途退出：直接结束本场（无限挑战，随时可重开） */
  async function abandon() {
    if (!battle || busy) return;
    if (!window.confirm('退出本场战斗？随时可以重新挑战。')) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.battleAbandon(battle.battleId);
      setBosses(await api.battleBosses());
      setPhase('list');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '退出失败');
    } finally {
      setBusy(false);
    }
  }

  async function answer(picked?: string, typed?: string) {
    if (!battle || busy) return;
    setBusy(true);
    setReveal(null);
    try {
      const r = await api.battleAnswer(battle.battleId, {
        ...(picked !== undefined ? { picked } : { typed }),
        ...(selId ? { cardId: selId } : {}),
      });
      setCombo(r.combo);
      setAnswered(r.answered);
      setHeroHp(r.heroHp);
      setBossHp(r.bossHp);
      setMana(r.mana);
      setHand(r.hand);
      setSummoned(r.summoned);

      if (r.finished) {
        setAnim(r.win ? { kind: 'hit', damage: r.damage } : { kind: 'hurt', damage: r.threat });
        if (r.win) playDraw();
        else playWrong();
        setTimeout(() => {
          setResult(r);
          setPhase('done');
        }, 700);
        return;
      }
      if (r.correct) {
        playCorrect(r.combo);
        setAnim({ kind: 'hit', damage: r.damage });
      } else {
        playWrong();
        setAnim({ kind: 'hurt', damage: r.threat });
        setReveal(r.reveal);
      }
      setTimeout(() => {
        setAnim(null);
        setSelId(null);
        setQ(r.next);
      }, 850);
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
    return <ResultView result={result} onAgain={() => setPhase('list')} bossName={battle?.boss.name} bossEmoji={battle?.boss.emoji} heroMaxHp={battle?.heroHp ?? 30} />;
  }

  if (phase === 'fight' && battle && q) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-800">⚔️ {battle.boss.emoji} {battle.boss.name}</h1>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
              回合 {answered + 1}/{battle.total}
            </span>
            <button
              onClick={() => void abandon()}
              disabled={busy}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-red-300 hover:text-red-500 disabled:opacity-40"
            >
              退出
            </button>
          </div>
        </div>

        {/* 战场 */}
        <div className="rounded-2xl bg-gradient-to-b from-emerald-900 to-emerald-950 p-4 shadow-lg ring-1 ring-emerald-800">
          {/* 对手英雄 */}
          <div className="flex items-center gap-2">
            <Hero portrait="🧙" label="对手" hp={bossHp} maxHp={battle.boss.hp} />
            <ManaGems mana={battle.total} max={battle.total} dim />
            <div className="ml-auto flex gap-1">
              {[...Array(3)].map((_, i) => (
                <span key={i} className="h-6 w-4 rounded-[4px] border border-amber-800 bg-gradient-to-br from-amber-700 to-amber-900" />
              ))}
            </div>
          </div>

          {/* 战场：对手随从 vs 我方随从 */}
          <div className="mt-3 flex items-stretch gap-2">
            <div className="flex flex-1 items-center justify-center">
              <OpponentMinion q={q} anim={anim} reveal={reveal} />
            </div>
            <div className="flex w-10 flex-col items-center justify-center gap-1 text-[9px] font-bold text-emerald-200">
              <span className="rounded-full bg-black/30 px-1.5 py-0.5">答对</span>
              <span className="text-base">⚔️</span>
              <span className="rounded-full bg-black/30 px-1.5 py-0.5">连击 {combo}</span>
            </div>
            <div className="flex flex-1 items-center justify-center">
              {summoned ? (
                <MinionCard card={summoned} side="me" />
              ) : (
                <div className="flex h-[96px] w-[92px] items-center justify-center rounded-xl border-2 border-dashed border-emerald-700 text-center text-[10px] leading-relaxed text-emerald-300/60">
                  召唤随从<br />出战！
                </div>
              )}
            </div>
          </div>

          {/* 题目 */}
          <QuestionCard key={q.id} q={q} busy={busy} reveal={reveal} onSubmit={answer} />

          {/* 我方英雄 + 法力 */}
          <div className="mt-2 flex items-center gap-2">
            <Hero portrait="🛡️" label="你" hp={heroHp} maxHp={battle.heroHp} />
            <ManaGems mana={mana} max={10} />
            <span className="ml-auto text-[10px] text-emerald-200/80">法力 {mana}/10</span>
          </div>

          {/* 手牌 */}
          <HandRow
            hand={hand}
            mana={mana}
            selId={selId}
            busy={busy}
            onSelect={(id) => setSelId((cur) => (cur === id ? null : id))}
          />

          <p className="mt-2 text-center text-[10px] leading-relaxed text-emerald-200/60">
            答对 → 召唤选中随从攻击（{'\u2694'}ATK+连击）· 答错 → 被对手随从反击（-威胁值）
          </p>
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
            今日首胜 {bosses.battleWinsToday}/3
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        炉石式词灵对决：对手每回合打出一张词灵随从，你答题破解——答对召唤手牌词卡出招（连击增伤），答错被随从反击。
        <b className="text-slate-500">无限挑战！</b>每词灵每日首胜得词力积分 + 抽卡次数 + 限定随从卡，之后继续挑战仍得词力积分。
      </p>

      <div className="space-y-3">
        {bosses?.bosses.map((b) => {
          return (
            <div
              key={b.id}
              className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ${b.wonToday ? 'ring-emerald-200' : 'ring-slate-100'}`}
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
                <span>🛡️ 英雄 {b.hp}</span>
                <span>💎 胜 +{b.rewardPoints} 词力</span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {b.wonToday && (
                  <p className="min-w-0 flex-1 rounded-xl bg-emerald-50 py-2 text-center text-[11px] font-medium text-emerald-600">
                    ✅ 首胜奖励已领
                  </p>
                )}
                <button
                  onClick={() => void start(b)}
                  disabled={busy}
                  className={`${b.wonToday ? 'flex-1' : 'w-full'} rounded-xl bg-gradient-to-r from-red-500 to-rose-500 py-2.5 font-bold text-white transition hover:brightness-105 disabled:opacity-50`}
                >
                  {busy ? '开战中…' : '⚔️ 挑战'}
                </button>
              </div>
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

/* ── 英雄行 ── */
function Hero({ portrait, label, hp, maxHp }: { portrait: string; label: string; hp: number; maxHp: number }) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl ring-2 ring-white/40">
          {portrait}
        </span>
        <span className="absolute -bottom-1 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-red-400 to-red-600 text-[11px] font-black text-white ring-2 ring-white">
          {Math.max(0, hp)}
        </span>
      </div>
      <div className="w-16">
        <p className="text-[11px] font-bold text-white">{label}</p>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/30">
          <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-rose-400 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

/* ── 法力水晶 ── */
function ManaGems({ mana, max, dim }: { mana: number; max: number; dim?: boolean }) {
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          className={`inline-block h-3.5 w-3.5 rotate-45 rounded-[3px] border ${
            i < mana
              ? dim
                ? 'border-slate-300 bg-slate-300/70'
                : 'border-sky-200 bg-gradient-to-br from-sky-300 to-blue-600 shadow-[0_0_6px_rgba(125,211,252,.7)]'
              : 'border-slate-600 bg-slate-800/80'
          }`}
        />
      ))}
    </div>
  );
}

/* ── 对手随从（= 当前题目词） ── */
function OpponentMinion({ q, anim, reveal }: { q: BattleQuestion; anim: { kind: 'hit' | 'hurt'; damage: number } | null; reveal: string | null }) {
  const threat = opponentThreat(q.difficulty);
  return (
    <div
      className={`wf-card-in relative w-[92px] rounded-xl border-2 border-fuchsia-400 bg-gradient-to-b from-indigo-700 to-indigo-950 px-2 pb-4 pt-2 text-center shadow-[0_10px_24px_rgba(0,0,0,.45)] ${anim?.kind === 'hit' ? 'wf-shake' : ''}`}
    >
      <span className="text-xl">🌀</span>
      <p className="text-[13px] font-black leading-tight text-white">{q.wordText}</p>
      {q.phonetic && <p className="text-[8px] text-indigo-200">{q.phonetic}</p>}
      <p className="mt-1 line-clamp-2 text-[8px] leading-snug text-indigo-100">{q.prompt}</p>
      <span className="absolute -bottom-1.5 -left-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-amber-300 to-amber-600 text-[11px] font-black text-amber-950">
        {threat}
      </span>
      <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-red-400 to-red-600 text-[11px] font-black text-white">
        4
      </span>
      {anim?.kind === 'hit' && (
        <span className="wf-dmg absolute -top-4 right-0 text-lg font-black text-amber-300">-{anim.damage}</span>
      )}
      {reveal && (
        <p className="mt-1 rounded bg-black/40 px-1 py-0.5 text-[9px] font-bold text-amber-200">正确：{reveal}</p>
      )}
    </div>
  );
}

/* ── 我方随从 ── */
function MinionCard({ card, side }: { card: HandCard; side: 'me' }) {
  return (
    <div
      className={`wf-card-in relative w-[92px] rounded-xl border-2 ${RARITY_BORDER[card.rarity]} bg-gradient-to-b from-amber-50 to-amber-100 px-2 pb-4 pt-2 text-center text-amber-950 shadow-[0_10px_24px_rgba(0,0,0,.45)]`}
    >
      <span className="absolute -top-2 -left-2 flex h-5 w-5 rotate-45 items-center justify-center rounded-[3px] border border-sky-100 bg-gradient-to-br from-sky-300 to-blue-600">
        <b className="-rotate-45 text-[9px] text-sky-950">{card.cost}</b>
      </span>
      <span className="text-xl">{side === 'me' ? '🛡️' : '🌀'}</span>
      <p className="text-[13px] font-black leading-tight">{card.wordText}</p>
      {card.skill && <p className="mt-0.5 text-[8px] font-bold text-amber-600">{card.skill}</p>}
      <span className="absolute -bottom-1.5 -left-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-amber-300 to-amber-600 text-[11px] font-black text-amber-950">
        {card.atk}
      </span>
      <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-red-400 to-red-600 text-[11px] font-black text-white">
        {card.hp}
      </span>
    </div>
  );
}

/* ── 题目卡 ── */
function QuestionCard({
  q,
  busy,
  reveal,
  onSubmit,
}: {
  q: BattleQuestion;
  busy: boolean;
  reveal: string | null;
  onSubmit: (picked?: string, typed?: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  if (q.kind === 'spell') {
    return (
      <div className="mt-3 rounded-xl bg-white/95 p-3 shadow">
        <div className="mb-2 text-center">
          <p className="text-sm font-bold leading-relaxed text-slate-700">{q.prompt}</p>
          {!reveal && <p className="mt-2 font-mono text-base tracking-[0.35em] text-slate-400">{q.hint}</p>}
          {reveal && <p className="mt-2 text-xl font-black tracking-wider text-emerald-600">{reveal}</p>}
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
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-base outline-none focus:border-blue-400"
          />
          <button
            type="submit"
            disabled={busy || !typed.trim() || !!reveal}
            className="rounded-lg bg-blue-600 px-4 font-bold text-white disabled:opacity-40"
          >
            出招!
          </button>
        </form>
        {q.example && (
          <div className="mt-2 text-left">
            <ExampleSentence sentence={q.example} zh={q.exampleZh} word={q.wordText} />
          </div>
        )}
      </div>
    );
  }

  const isWordChoice = q.kind === 'word-choice';
  return (
    <div className="mt-3 rounded-xl bg-white/95 p-3 shadow">
      <div className="mb-2 text-center">
        {isWordChoice ? (
          <p className="text-sm font-bold leading-relaxed text-slate-700">{q.prompt}</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1.5">
              <p className="text-2xl font-black tracking-wide text-slate-800">{q.wordText}</p>
              <SpeakerButton text={q.wordText} className="!h-6 !w-6 !text-xs" />
            </div>
            {q.phonetic && <p className="mt-0.5 font-mono text-xs text-slate-400">{q.phonetic}</p>}
          </>
        )}
        <p className="mt-0.5 text-[10px] text-slate-400">{isWordChoice ? '选择对应的单词' : '选择正确的释义'}</p>
      </div>
      <div className={`grid gap-2 ${isWordChoice ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {q.options?.map((o) => {
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
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${cls}`}
            >
              {!isWordChoice && <span className="font-bold text-slate-400">{o.key}</span>}
              <span className="text-slate-700">{o.text}</span>
            </button>
          );
        })}
      </div>
      {reveal && (
        <p className="mt-2 text-center text-xs font-medium text-red-500">
          正确答案：<b className="text-emerald-600">{reveal}</b>
        </p>
      )}
    </div>
  );
}

/* ── 手牌 ── */
function HandRow({
  hand,
  mana,
  selId,
  busy,
  onSelect,
}: {
  hand: HandCard[];
  mana: number;
  selId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-2 flex justify-center gap-1.5">
      {hand.map((c) => {
        const affordable = c.cost <= mana;
        const sel = selId === c.wordId;
        return (
          <button
            key={c.wordId}
            onClick={() => affordable && !busy && onSelect(c.wordId)}
            disabled={busy || !affordable}
            className={`relative w-[54px] rounded-lg border-[1.5px] px-1 pb-3 pt-1.5 text-center transition ${
              sel ? '-translate-y-2 border-amber-400 bg-gradient-to-b from-amber-50 to-amber-100 shadow-[0_6px_14px_rgba(251,191,36,.45)]' : RARITY_BORDER[c.rarity] + ' bg-gradient-to-b from-amber-50 to-amber-100'
            } ${affordable ? '' : 'opacity-40 grayscale'}`}
          >
            <span className="absolute -left-1 -top-1.5 flex h-4 w-4 rotate-45 items-center justify-center rounded-[2px] border border-sky-100 bg-gradient-to-br from-sky-300 to-blue-600">
              <b className="-rotate-45 text-[8px] text-sky-950">{c.cost}</b>
            </span>
            <span className="text-base">{sel ? '🛡️' : '🃏'}</span>
            <p className="text-[9px] font-black leading-tight text-amber-950">{c.wordText}</p>
            <span className="absolute -bottom-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-gradient-to-br from-amber-300 to-amber-600 text-[8px] font-black text-amber-950">
              {c.atk}
            </span>
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-gradient-to-br from-red-400 to-red-600 text-[8px] font-black text-white">
              {c.hp}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── 结算页 ── */
function ResultView({
  result,
  onAgain,
  bossName,
  bossEmoji,
  heroMaxHp,
}: {
  result: BattleAnswerResponse;
  onAgain: () => void;
  bossName?: string;
  bossEmoji?: string | null;
  heroMaxHp: number;
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
          对 {result.correctCount}/{result.total} 题 · 英雄剩余 ❤️ {result.heroHp}/{heroMaxHp} · 最高连击 🔥 {result.combo}
        </p>

        <div className="mt-6 space-y-2.5 text-left">
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">💎 词力积分</span>
            <span className="font-bold text-amber-600">+{result.reward?.points ?? 0}</span>
          </div>
          {win && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
              <span className="text-sm text-slate-600">🎴 限定随从卡</span>
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
            <p className="text-[10px] tracking-widest opacity-80">{card.rarity} 限定随从卡</p>
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
