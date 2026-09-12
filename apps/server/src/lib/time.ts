/** 时间工具：全库统一 ISO8601 UTC 文本 + YYYY-MM-DD 日期键（UTC） */

export function nowIso(): string {
  return new Date().toISOString();
}

export function dateKeyUtc(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayStartIso(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`;
}
