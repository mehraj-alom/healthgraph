/**
 * sleepEngine.ts — Sleep Engine pure contract (Batch 6B).
 *
 * The first goal-driven engine: active when 'sleep' is among the Batch 6A
 * active-engine ids. Every number here comes from real logged nights
 * supplied by the caller; the module never fetches, never synthesizes, and
 * never interprets. Bedtime/wake times are optional per night (from the
 * SLEEP_LOG event payload when the user logs them) and feed one
 * descriptive consistency line only — no stages, no wearable integration,
 * no scores, no recommendations. Empty in → null out, never a zero chart.
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
  /** Optional bedtime 'HH:MM' from the SLEEP_LOG event payload. */
  bedtime?: string | null;
  /** Optional wake time 'HH:MM' from the SLEEP_LOG event payload. */
  wakeTime?: string | null;
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

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Strict 'HH:MM' → minutes since midnight, or null. Clock times come from
 * user input and event payloads — both untrusted, both validated here.
 */
export function parseClockTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = CLOCK_RE.exec(value);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Minutes from bedtime to wake time, crossing midnight when needed.
 * Null when either side is missing/invalid or the span is zero (a
 * zero-length "night" is a logging mistake, never a measurement).
 */
export function durationFromBedWake(bedtime: unknown, wakeTime: unknown): number | null {
  const bed = parseClockTime(bedtime);
  const wake = parseClockTime(wakeTime);
  if (bed === null || wake === null) return null;
  const span = (wake - bed + 1440) % 1440;
  return span === 0 ? null : span;
}

/**
 * Bedtime minutes linearized from noon, so night times order correctly
 * (22:30 → evening, 06:30 → next morning) for span math.
 */
function linearBedMinutes(clockMinutes: number): number {
  return (clockMinutes - 720 + 1440) % 1440;
}

/** "45m" / "1h 20m" — display only. */
function formatSpanMinutes(spanMinutes: number): string {
  const mins = Math.round(spanMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Descriptive bedtime consistency over the trailing 7 days, e.g.
 * "Bedtimes spanned 1h 20m across 3 nights". Null with fewer than two
 * timed nights — a single bedtime has no spread to describe. Purely
 * descriptive: no score, no judgment, no recommendation.
 */
export function describeSleepConsistency(
  nights: readonly SleepNight[],
  todayKey: string,
): string | null {
  const start = shiftDayKey(todayKey, -6);
  const times: number[] = [];
  for (const n of nights) {
    const day = n.date.slice(0, 10);
    if (day < start || day > todayKey) continue;
    const parsed = parseClockTime(n.bedtime);
    if (parsed !== null) times.push(linearBedMinutes(parsed));
  }
  if (times.length < 2) return null;
  const span = Math.max(...times) - Math.min(...times);
  return `Bedtimes spanned ${formatSpanMinutes(span)} across ${times.length} ${times.length === 1 ? 'night' : 'nights'}`;
}
