/**
 * 连续打卡 streak 工具（游戏化三件套之一）
 * 输入为用户有学习记录的日期集合（YYYY-MM-DD，按用户时区归一化由调用方完成）。
 */

export function todayKey(d: Date = new Date()): string {
  return toDateKey(d);
}

export function toDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  if (y == null || m == null || d == null) return key;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + delta);
  return toDateKey(date);
}

/**
 * 计算当前连续打卡天数：
 * - 从今天（或昨天——今天还没学不打断 streak）往前数连续记录天数。
 */
export function computeStreak(recordedDates: Iterable<string>, today: string = todayKey()): number {
  const set = new Set(recordedDates);
  let cursor = set.has(today) ? today : shiftDays(today, -1);
  // 今天和昨天都没有记录 → streak 断了
  if (!set.has(cursor)) return 0;

  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}

/** 最长连续打卡（统计页展示用） */
export function longestStreak(recordedDates: Iterable<string>): number {
  const sorted = [...new Set(recordedDates)].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of sorted) {
    run = prev != null && shiftDays(prev, 1) === key ? run + 1 : 1;
    prev = key;
    if (run > longest) longest = run;
  }
  return longest;
}
