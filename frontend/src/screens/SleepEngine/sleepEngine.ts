/**
 * sleepEngine.ts — Sleep Engine pure contract (Batch 6B).
 *
 * The first goal-driven engine: active when 'sleep' is among the Batch 6A
 * active-engine ids. Every number here comes from real logged nights
 * supplied by the caller; the module never fetches, never synthesizes, and
 * never interprets. No bedtime/wake timestamps exist on device, no sleep
 * stages exist, no wearable integration exists — so there is no consistency
 * or stage math here, only logged duration (minutes), 1–5 quality, and
 * awakenings from daily check-ins. Empty in → null out, never a zero chart.
 *
 * Period comparison mirrors the shared changes.ts contract (same trailing-7
 * vs prior-7 windows, same absolute-minute deltas, same descriptive copy)
 * so the engine dashboard and the hub card can never disagree — a parity
 * test in batch6b guards divergence. The logic is intentionally inlined
 * rather than imported: node-tested pure modules in this codebase keep
 * zero imports (Metro resolves extensionless paths, node strip-types
 * needs extensions, and the two cannot share one specifier).
 *
 * Zero imports: safe for node unit tests.
 */

/** A real logged night: date + group-level sleep columns. */
export interface SleepNight {
  date: string;
  durationMinutes: number;
  quality: number | null;
  awakenings: number | null;
}

/** One cell of the trailing-7-day strip. */
export interface SleepWeekDay {
  date: string;
  logged: boolean;
  durationMinutes: number | null;
}

/** Bounded history window the engine reads (trailing days, inclusive). */
export const SLEEP_HISTORY_DAYS = 28;

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * This week (todayKey − 6 … todayKey) vs the preceding 7 days — the same
 * windows changes.ts weekWindows() produces (parity-tested).
 */
function sleepWindows(todayKey: string): {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
} {
  return {
    currentStart: shiftDayKey(todayKey, -6),
    currentEnd: todayKey,
    previousStart: shiftDayKey(todayKey, -13),
    previousEnd: shiftDayKey(todayKey, -7),
  };
}

/** Mean over finite values; null when empty (mirrors changes.summarize). */
function meanOrNull(values: readonly number[]): { count: number; avg: number | null } {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return { count: 0, avg: null };
  return { count: clean.length, avg: clean.reduce((s, v) => s + v, 0) / clean.length };
}

/**
 * Absolute-delta line for averages (minutes mislead as percentages):
 * "+42 min vs last week", "→ 0 min vs last week", or null when either
 * side has no usable aggregate — mirrors changes.describeChange with
 * mode 'average', usePercent false (parity-tested).
 */
function absoluteDeltaLine(
  current: { count: number; avg: number | null },
  previous: { count: number; avg: number | null },
  unit: string,
  periodLabel: string,
): string | null {
  if (previous.count < 1 || current.count === 0) return null;
  if (previous.avg === null || current.avg === null) return null;
  const delta = current.avg - previous.avg;
  const rounded = Math.abs(delta) < 10 ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return `→ 0 ${unit} ${periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded)} ${unit} ${periodLabel}`;
}

/** Earliest date (inclusive) of a trailing-N-day window ending todayKey. */
export function sleepWindowStart(todayKey: string, days: number = SLEEP_HISTORY_DAYS): string {
  return shiftDayKey(todayKey, -(days - 1));
}

/** True when the Sleep Engine is selected in the Batch 6A engine system. */
export function isSleepEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes('sleep');
}

/** Trailing-7-day strip (oldest first); a day counts only with a duration. */
export function buildSleepWeek(
  nights: readonly SleepNight[],
  todayKey: string,
): SleepWeekDay[] {
  const byDate = new Map(nights.map((n) => [n.date.slice(0, 10), n]));
  const days: SleepWeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDayKey(todayKey, -i);
    const night = byDate.get(date);
    days.push({
      date,
      logged: night != null,
      durationMinutes: night?.durationMinutes ?? null,
    });
  }
  return days;
}

export interface SleepSummary {
  /** Nights with a logged duration inside the window. */
  loggedNights: number;
  /** Mean duration over logged nights; null when none. */
  avgMinutes: number | null;
  /** Most recent logged night; null when none. */
  latest: SleepNight | null;
}

/** Summary over the window; nulls (never zeros) when there is no data. */
export function summarizeSleepNights(nights: readonly SleepNight[]): SleepSummary {
  if (nights.length === 0) return { loggedNights: 0, avgMinutes: null, latest: null };
  const summary = meanOrNull(nights.map((n) => n.durationMinutes));
  const latest = [...nights].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1) ?? null;
  return {
    loggedNights: nights.length,
    avgMinutes: summary.count > 0 ? summary.avg : null,
    latest,
  };
}

/**
 * Descriptive trailing-7-vs-prior-7 average line, e.g.
 * "Average sleep +42 min vs last week". Null when either window lacks
 * real nights. Same windows/math as the hub sleep card (changes.ts).
 */
export function describeSleepChange(
  nights: readonly SleepNight[],
  todayKey: string,
  periodLabel = 'vs last week',
): string | null {
  const windows = sleepWindows(todayKey);
  const inCurrent: number[] = [];
  const inPrevious: number[] = [];
  for (const n of nights) {
    const day = n.date.slice(0, 10);
    if (day >= windows.currentStart && day <= windows.currentEnd) inCurrent.push(n.durationMinutes);
    else if (day >= windows.previousStart && day <= windows.previousEnd) inPrevious.push(n.durationMinutes);
  }
  const line = absoluteDeltaLine(meanOrNull(inCurrent), meanOrNull(inPrevious), 'min', periodLabel);
  return line ? `Average sleep ${line}` : null;
}

/** "7h 30m" / "45m" — display only, no rounding of stored values. */
export function formatSleepDuration(totalMinutes: number): string {
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
