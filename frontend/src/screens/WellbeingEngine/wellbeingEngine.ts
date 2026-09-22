/**
 * wellbeingEngine.ts — Wellbeing Engine pure contract (Batch 6G).
 *
 * Built ONLY from user-entered 1–5 check-in ratings: overall_wellbeing
 * (mood), energy_level, and stress_level. Scales are preserved as-is
 * ("4.1 / 5") — never converted away from the 1–5 scale, never combined
 * into one number. Sleep duration, appetite, adherence, and heart rate
 * are NOT wellbeing signals and never enter this module.
 *
 * Rules:
 * - averages divide over days WITH each rating, never over all days;
 * - missing stays missing (null, never zero);
 * - period comparison mirrors the shared changes.ts contract
 *   (absolute point deltas, null when either side is empty) —
 *   parity-tested; the logic is inlined because node-tested pure
 *   modules keep zero imports.
 *
 * Deliberately absent: clinical instruments (none exist on device),
 * journals-as-ratings, emotion classification, combined headline
 * numbers, deficit or risk math, diagnoses, and any clinical
 * interpretation. Copy reports recorded values only — never improved
 * or declined as a health judgment, never causal.
 *
 * Zero imports: safe for node unit tests.
 */

/** The Batch 6A engine id that activates this engine. */
export const WELLBEING_ENGINE_ID = 'wellbeing';

/** Bounded history window the engine reads (trailing days, inclusive). */
export const WELLBEING_HISTORY_DAYS = 28;

/** True when the Wellbeing Engine is selected in the Batch 6A system. */
export function isWellbeingEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(WELLBEING_ENGINE_ID);
}

/** One day with at least one user-entered 1–5 rating. */
export interface WellbeingDay {
  date: string;
  mood: number | null;
  energy: number | null;
  stress: number | null;
}

export type WellbeingMetric = 'mood' | 'energy' | 'stress';

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Earliest date (inclusive) of a trailing-N-day window ending todayKey. */
export function wellbeingWindowStart(todayKey: string, days: number = WELLBEING_HISTORY_DAYS): string {
  return shiftDayKey(todayKey, -(days - 1));
}

/** Days in the trailing 7 days (inclusive). */
export function trailingWeekWellbeing(
  days: readonly WellbeingDay[],
  todayKey: string,
): WellbeingDay[] {
  const start = shiftDayKey(todayKey, -6);
  return days.filter((d) => {
    const day = d.date.slice(0, 10);
    return day >= start && day <= todayKey;
  });
}

/** Days in the prior 7 days (comparison baseline). */
export function priorWeekWellbeing(
  days: readonly WellbeingDay[],
  todayKey: string,
): WellbeingDay[] {
  const start = shiftDayKey(todayKey, -13);
  const end = shiftDayKey(todayKey, -7);
  return days.filter((d) => {
    const day = d.date.slice(0, 10);
    return day >= start && day <= end;
  });
}

function validRatings(days: readonly WellbeingDay[], metric: WellbeingMetric): number[] {
  return days
    .map((d) => d[metric])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

export interface WellbeingSummary {
  /** Days with at least one rating in the window. */
  ratedDays: number;
  /** Mean mood over mood-rated days; null when none. */
  avgMood: number | null;
  /** Mean energy over energy-rated days; null when none. */
  avgEnergy: number | null;
  /** Mean stress over stress-rated days; null when none. */
  avgStress: number | null;
}

/** Summary over the window; nulls (never zeros) where nothing was rated. */
export function summarizeWellbeing(days: readonly WellbeingDay[]): WellbeingSummary {
  const mean = (values: number[]): number | null =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    ratedDays: days.length,
    avgMood: mean(validRatings(days, 'mood')),
    avgEnergy: mean(validRatings(days, 'energy')),
    avgStress: mean(validRatings(days, 'stress')),
  };
}

/**
 * Absolute-delta line for a 1–5 rating average, e.g.
 * "Average mood +0.4 pts vs prior week". Null when either week has no
 * rating for the metric. Mirrors changes.describeChange mode 'average',
 * unit 'pts', usePercent false (parity-tested). Direction is a number,
 * never a health judgment.
 */
export function describeRatingChange(
  metric: WellbeingMetric,
  current: readonly WellbeingDay[],
  previous: readonly WellbeingDay[],
  periodLabel = 'vs prior week',
): string | null {
  const cur = validRatings(current, metric);
  const prev = validRatings(previous, metric);
  if (cur.length === 0 || prev.length === 0) return null;
  const curAvg = cur.reduce((a, b) => a + b, 0) / cur.length;
  const prevAvg = prev.reduce((a, b) => a + b, 0) / prev.length;
  const delta = curAvg - prevAvg;
  const rounded = Math.abs(delta) < 10 ? Math.round(delta * 10) / 10 : Math.round(delta);
  const label = metric === 'mood' ? 'Average mood' : metric === 'energy' ? 'Average energy' : 'Average stress';
  if (rounded === 0) return `${label} → 0 pts ${periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  return `${label} ${sign}${Math.abs(rounded)} pts ${periodLabel}`;
}

/** "4.1 / 5" — scale-preserving display, one decimal, no rescaling. */
export function formatRating(value: number): string {
  return `${Math.round(value * 10) / 10} / 5`;
}
