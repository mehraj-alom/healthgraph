/**
 * changes.ts — deterministic period-over-period comparison (pure).
 *
 * Every number here comes from real stored rows supplied by the caller; the
 * module never fetches, never synthesizes, and never uses an LLM. Rules:
 *
 * - A percentage is computed ONLY when the baseline period holds enough
 *   real values (default: at least one) AND the baseline aggregate is
 *   non-zero. Otherwise the result is null and the caller shows the plain
 *   absolute value instead of inventing a percentage.
 * - Metrics where percentages mislead (bpm, minutes) use absolute deltas
 *   that preserve the original unit.
 * - Copy is descriptive, never interpretive: arrows + numbers + the
 *   comparison period. No good/bad/healthier/improved language anywhere.
 *
 * Zero imports: safe for node unit tests.
 */

export interface WeekWindows {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return toDayKey(d);
}

/**
 * This week (todayKey − 6 … todayKey) vs the preceding 7 days.
 * Date math handles month/year boundaries.
 */
export function weekWindows(todayKey: string): WeekWindows {
  return {
    currentStart: shiftDayKey(todayKey, -6),
    currentEnd: todayKey,
    previousStart: shiftDayKey(todayKey, -13),
    previousEnd: shiftDayKey(todayKey, -7),
  };
}

export function inWindow(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

export interface PeriodSummary {
  count: number;
  sum: number;
  avg: number | null;
}

/** Sum/count/avg over finite values only (non-finite entries are dropped). */
export function summarize(values: readonly number[]): PeriodSummary {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (clean.length === 0) return { count: 0, sum: 0, avg: null };
  const sum = clean.reduce((s, v) => s + v, 0);
  return { count: clean.length, sum, avg: sum / clean.length };
}

export interface ChangeInput {
  current: PeriodSummary;
  previous: PeriodSummary;
  /**
   * 'count' compares row counts (logged days); 'sum' compares totals
   * (meals, entries); 'average' compares means (bpm, minutes).
   */
  mode: 'count' | 'sum' | 'average';
  /** Display unit for absolute deltas ('bpm', 'min', …). */
  unit: string;
  /** Comparison label, e.g. 'vs last week'. */
  periodLabel: string;
  /** Minimum baseline values required for ANY comparison (default 1). */
  minPrevious?: number;
  /** False for metrics where percentages mislead (default true). */
  usePercent?: boolean;
}

/**
 * Describe the change or return null (caller shows the absolute value).
 * Null when: baseline too sparse, baseline aggregate is zero (never divide
 * by zero), or either side has no usable aggregate to compare.
 */
export function describeChange(input: ChangeInput): string | null {
  const minPrevious = input.minPrevious ?? 1;
  const usePercent = input.usePercent ?? true;
  if (input.previous.count < minPrevious) return null;
  if (input.current.count === 0) return null;

  const base = input.mode === 'average' ? input.previous.avg : input.mode === 'sum' ? input.previous.sum : input.previous.count;
  const current = input.mode === 'average' ? input.current.avg : input.mode === 'sum' ? input.current.sum : input.current.count;
  if (base === null || current === null) return null;

  if (usePercent) {
    // A zero baseline never yields a percentage.
    if (base === 0) return null;
    const pct = Math.round(((current - base) / Math.abs(base)) * 100);
    if (pct === 0) return `→ 0% ${input.periodLabel}`;
    const arrow = pct > 0 ? '↑' : '↓';
    return `${arrow} ${Math.abs(pct)}% ${input.periodLabel}`;
  }

  const delta = current - base;
  const rounded = Math.abs(delta) < 10 ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return `→ 0 ${input.unit} ${input.periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  const magnitude = Math.abs(rounded);
  return `${sign}${magnitude} ${input.unit} ${input.periodLabel}`;
}

/**
 * Adherence over taken-event statuses: TAKEN / (TAKEN + MISSED + SKIPPED).
 * LATE is excluded (ambiguous). Null when there is nothing to rate.
 */
export function adherencePercent(
  statuses: readonly string[],
): { text: string } | null {
  let taken = 0;
  let missed = 0;
  for (const s of statuses) {
    if (s === 'TAKEN') taken += 1;
    else if (s === 'MISSED' || s === 'SKIPPED') missed += 1;
  }
  const total = taken + missed;
  if (total === 0) return null;
  return { text: `Medication adherence: ${Math.round((taken / total) * 100)}%` };
}
