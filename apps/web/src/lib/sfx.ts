/**
 * 轻量 WebAudio 音效（P0 §十 A1 连击的听觉反馈）。
 * 不依赖任何音频文件；AudioContext 在首次用户手势后惰性创建。
 * 全部 try/catch 兜底：浏览器禁用/异常时静默降级为无声。
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, delay: number, dur: number, type: OscillatorType = 'sine', gain = 0.07): void {
  const ac = audio();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    /* 无声降级 */
  }
}

/** 答对：双音上行，连击越高音阶越高（封顶 12 级） */
export function playCorrect(combo: number): void {
  const base = 440 * Math.pow(1.06, Math.min(Math.max(combo, 1), 12));
  tone(base, 0, 0.11, 'triangle');
  tone(base * 1.5, 0.06, 0.16, 'triangle');
}

/** 答错：低音双连（轻微的「挫败感」，不长鸣） */
export function playWrong(): void {
  tone(170, 0, 0.16, 'sawtooth', 0.04);
  tone(120, 0.07, 0.18, 'sawtooth', 0.03);
}

/** 抽卡：三音上行号角 */
export function playDraw(): void {
  tone(523, 0, 0.1, 'sine', 0.08);
  tone(659, 0.09, 0.1, 'sine', 0.08);
  tone(784, 0.18, 0.24, 'sine', 0.09);
}
