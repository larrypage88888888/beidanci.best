/** 时间工具：全库统一 ISO8601 UTC 文本 + YYYY-MM-DD 日期键（北京时区 UTC+8） */

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 北京时区日期键（UTC+8）：词流面向中文用户，每日边界按北京时间。
 *
 * 修复：此前用 UTC 日期键，导致北京每天 0:00–8:00 之间被当成「昨天」——
 * Cron 在北京 0:30 物化的当日计划 date 落在「北京昨天」，用户清晨打开时命中
 * 的是已学完的昨日计划 → 当天没有新词（词全被「已学过」过滤）。
 */
export function dateKeyCn(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 8 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 某日期键的北京时区午夜（转 UTC ISO；原实现是 UTC 午夜=北京早 8 点，属边界错位） */
export function dayStartIso(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00+08:00`).toISOString();
}
