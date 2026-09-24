/**
 * 单词朗读（Web Speech API，零依赖零资产；M1 可升级 R2 真人音频 + howler）
 * - speak(text)：立即朗读英文单词/短语
 * - 自动朗读受「设置 → 发音」开关控制（localStorage 持久化）
 *
 * 引擎健壮性（Chrome/Safari 的已知坑）：
 * - iOS/Safari 需要在用户手势内触发过一次 speak 才解锁引擎 → 首次交互时静音预热
 * - iOS/Safari 同一时钟周期 cancel() 紧跟 speak() 会被吞掉 → 延后一拍再读
 * - Chrome 引擎偶发 paused 卡死，此后所有 speak 静默失败 → 读之前先 resume
 */

const AUTOSPEAK_KEY = 'wordflow.autospeak';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speechAutoEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return localStorage.getItem(AUTOSPEAK_KEY) !== '0';
}

export function setSpeechAutoEnabled(on: boolean): void {
  localStorage.setItem(AUTOSPEAK_KEY, on ? '1' : '0');
}

let primed = false;
/** 在用户手势内调用：发一段静音音频解锁引擎（iOS/Safari 必需，Chrome 无害） */
export function primeSpeech(): void {
  if (primed || !speechSupported()) return;
  primed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    u.lang = 'en-US';
    const voice = pickEnglishVoice(); // 预热也用本地嗓音，避免挂在网络嗓音上
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch {
    /* 静默失败 */
  }
}

// 首次任意交互即解锁语音引擎（capture 尽早触发；两个事件各 once，谁先算谁）
if (typeof document !== 'undefined' && 'speechSynthesis' in document) {
  const unlock = () => primeSpeech();
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('touchstart', unlock, { once: true, capture: true });
}

/** 是否由组件自动触发（手动点喇叭永远允许） */
export function autoSpeak(text: string, rate = 0.85): void {
  if (speechAutoEnabled()) speak(text, rate);
}

/** 发声诊断：afterMs 毫秒后返回引擎是否真的在朗读（speaking/pending/paused 任一） */
export function speechProbe(afterMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    if (!speechSupported()) return resolve(false);
    window.setTimeout(() => {
      try {
        const s = window.speechSynthesis;
        resolve(s.speaking || s.pending || s.paused);
      } catch {
        resolve(false);
      }
    }, afterMs);
  });
}

/** 共享的「下一拍再读」调度：避免 cancel/speak 同拍竞态，也防连续点击叠音 */
let speakTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSpeak(start: () => void): void {
  if (speakTimer) clearTimeout(speakTimer);
  speakTimer = setTimeout(() => {
    speakTimer = null;
    start();
  }, 60);
}

function makeUtterance(text: string, rate: number): SpeechSynthesisUtterance {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = rate;
  const voice = pickEnglishVoice();
  if (voice) utter.voice = voice;
  return utter;
}

export function speak(text: string, rate = 0.85): void {
  if (!speechSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (synth.paused) synth.resume();
    const utter = makeUtterance(text, rate);
    scheduleSpeak(() => {
      try {
        synth.resume(); // Chrome 偶发 paused 卡死；未暂停时 resume 无害
        synth.speak(utter);
      } catch {
        /* 静默失败 */
      }
    });
  } catch {
    /* 某些浏览器在无用户手势时会拒绝，静默失败即可 */
  }
}

/** 是否由组件自动触发（手动点喇叭永远允许） */
export function autoSpeakSequence(items: string[], rate = 0.85): void {
  if (speechAutoEnabled()) speakSequence(items, rate);
}

/** 顺序朗读多段文本：单词读完接例句，用 onend 链式衔接 */
export function speakSequence(items: string[], rate = 0.85): void {
  const texts = items.filter(Boolean);
  if (!speechSupported() || texts.length === 0) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (synth.paused) synth.resume();
    const speakAt = (i: number) => {
      if (i >= texts.length) return;
      const utter = makeUtterance(texts[i]!, rate);
      utter.onend = () => speakAt(i + 1);
      synth.speak(utter);
    };
    scheduleSpeak(() => {
      try {
        synth.resume();
        speakAt(0);
      } catch {
        /* 静默失败 */
      }
    });
  } catch {
    /* 同上，静默失败 */
  }
}

/**
 * 挑选英文嗓音：本地引擎优先（离线可用、国内无障碍）。
 *
 * Windows 的 Chrome/Edge 会同时列出本地嗓音（Microsoft Zira/David 等，localService=true）
 * 和 Google 网络嗓音（localService=false，需要连 Google 服务器——国内不可达，
 * 选中会静默无声）。因此本地嗓音优先，网络嗓音只作最后兜底。
 */
export function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const norm = (lang: string) => lang.toLowerCase().replace('_', '-');
  const en = voices.filter((v) => norm(v.lang).startsWith('en'));
  if (en.length === 0) return null;
  const local = en.filter((v) => v.localService);
  const online = en.filter((v) => !v.localService);
  const nice = /natural|aria|jenny|samantha|zira|david|hazel|george|susannah/i;
  return (
    local.find((v) => nice.test(v.name)) ??
    local.find((v) => norm(v.lang) === 'en-us') ??
    local[0] ??
    // 本地没有英文嗓音才退到在线嗓音（Edge 的 Natural 在线嗓音国内可达）
    online.find((v) => nice.test(v.name)) ??
    online.find((v) => norm(v.lang) === 'en-us') ??
    online[0] ??
    null
  );
}

// Chrome 首次 getVoices 为空，监听一次变化以预热缓存
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    /* 仅触发引擎加载嗓音列表 */
  };
}
