/**
 * 单词朗读（Web Speech API，零依赖零资产；M1 可升级 R2 真人音频 + howler）
 * - speak(text)：立即朗读英文单词/短语
 * - 自动朗读受「设置 → 发音」开关控制（localStorage 持久化）
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

/** 是否由组件自动触发（手动点喇叭永远允许） */
export function autoSpeak(text: string, rate = 0.85): void {
  if (speechAutoEnabled()) speak(text, rate);
}

export function speak(text: string, rate = 0.85): void {
  if (!speechSupported() || !text) return;
  try {
    // 打断上一段，快速切题时不叠加
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = rate;
    const voice = pickEnglishVoice();
    if (voice) utter.voice = voice;
    window.speechSynthesis.speak(utter);
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
    window.speechSynthesis.cancel();
    const speakAt = (i: number) => {
      if (i >= texts.length) return;
      const utter = new SpeechSynthesisUtterance(texts[i]!);
      utter.lang = 'en-US';
      utter.rate = rate;
      const voice = pickEnglishVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => speakAt(i + 1);
      window.speechSynthesis.speak(utter);
    };
    speakAt(0);
  } catch {
    /* 同上，静默失败 */
  }
}

/** 优先挑自然的英文嗓音（Chrome/Edge 的 Google/Natural 系列），否则退回任意英文 */
function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null; // 嗓音列表异步加载，缺失时交给 lang 兜底
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => /natural|google us english|aria|jenny|samantha|zira/i.test(v.name)) ??
    en.find((v) => v.lang === 'en-US') ??
    en[0] ??
    null
  );
}

// Chrome 首次 getVoices 为空，监听一次变化以预热缓存
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    /* 仅触发引擎加载嗓音列表 */
  };
}
