/**
 * habitTracker.ts — GitHub-style activity grid contract (pure).
 *
 * Builds a trailing-16-week × 7-day grid from per-day tracked-action
 * counts supplied by the caller (the hook counts real rows: check-ins,
 * doses, entries, measurements). Cells carry honest counts — a day with
 * no action is level 0, never an average or estimate. Intensity levels
 * are fixed thresholds over counts, documented below.
 *
 * Zero imports: safe for node unit tests.
 */

/** Trailing weeks shown in the grid. */
export const HABIT_WEEKS = 16;

/** Intensity of one day: 0 = no tracked action. */
export function habitLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

export interface HabitCell {
  /** Local calendar day (YYYY-MM-DD). */
  date: string;
  /** Real tracked actions that day (0 when none). */
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  /** True when the day lies in the future (renders blank, not zero). */
  future: boolean;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Sixteen week-columns (oldest first), each with Sunday→Saturday cells.
 * The grid starts on the Sunday HABIT_WEEKS weeks back; days after today
 * are marked future (blank) rather than zero.
 */
export function buildHabitWeeks(
  counts: ReadonlyMap<string, number>,
  todayKey: string,
): HabitCell[][] {
  const today = new Date(`${todayKey}T12:00:00`);
  const startOffset = (today.getDay() + 7 * (HABIT_WEEKS - 1)) * -1;
  const weeks: HabitCell[][] = [];
  for (let w = 0; w < HABIT_WEEKS; w++) {
    const days: HabitCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = shiftDayKey(todayKey, startOffset + w * 7 + d);
      const future = date > todayKey;
      const count = future ? 0 : Math.max(0, Math.floor(counts.get(date) ?? 0));
      days.push({ date, count, level: future ? 0 : habitLevel(count), future });
    }
    weeks.push(days);
  }
  return weeks;
}
