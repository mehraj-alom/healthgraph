/**
 * disciplineEngine.ts — Discipline Engine pure contract (Batch 6D).
 *
 * Answers "what health-related actions have I actually been consistently
 * doing?" from real patient-scoped records. An "active day" is a calendar
 * day with at least one intentional tracked action from any of:
 *
 * - daily check-in rows (daily_logs.log_date — logging the day is the act);
 * - medication dose events (medication_taken_events.taken_at instants,
 *   attributed to local calendar days — any status counts as the act of
 *   logging; adherence math is separate and excludes LATE per contract);
 * - substance entries (occurred_at, local wall time);
 * - cycle entries (date, calendar day);
 * - camera heart measurements (measured_at, same slice precedent as the
 *   activity feed).
 *
 * Sleep nights are intentionally NOT a separate source: a logged night
 * implies its check-in row, so it can never add a day to the union.
 *
 * There is deliberately NO blended number here: unrelated behaviors are
 * never combined into one metric. Active-day counts, the streak, and adherence
 * are reported as separate factual lines. Adherence and period comparison
 * mirror the shared changes.ts contract (parity-tested); the logic is
 * inlined because node-tested pure modules keep zero imports.
 *
 * Copy is descriptive counts only — never character judgments, never
 * a mental-health inference, never causal.
 *
 * Zero imports: safe for node unit tests.
 */

/** The Batch 6A engine id that activates this engine. */
export const DISCIPLINE_ENGINE_ID = 'discipline';

/** Bounded history window the engine reads (trailing days, inclusive). */
export const DISCIPLINE_HISTORY_DAYS = 14;

/** True when the Discipline Engine is selected in the Batch 6A system. */
export function isDisciplineEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(DISCIPLINE_ENGINE_ID);
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
 * Local calendar day (YYYY-MM-DD) of a stored instant (UTC ISO-8601).
 * Dose instants need real timezone attribution — slicing the UTC string
 * would misattribute evening doses near midnight.
 */
export function localDayKeyOfInstant(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calendar day of a local wall-time or date string (log_date, occurred_at,
 * cycle date, measured_at — all start with YYYY-MM-DD by contract, the
 * same slice precedent the activity feed uses).
 */
export function sliceDayKey(value: string): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * ISO instant bounds [start, end) for a trailing-N-day window ending now:
 * local midnight N−1 days ago through the current instant.
 */
export function trailingRangeIso(todayKey: string, days: number): [string, string] {
  const [y, m, d] = todayKey.split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1);
  start.setDate(start.getDate() - (days - 1));
  return [start.toISOString(), new Date().toISOString()];
}

export interface DisciplineSources {
  /** daily_logs.log_date values (YYYY-MM-DD). */
  logDates: readonly string[];
  /** medication taken_at instants (UTC ISO-8601). */
  takenInstants: readonly string[];
  /** substance occurred_at values (local wall time). */
  substanceDates: readonly string[];
  /** cycle entry dates (YYYY-MM-DD). */
  cycleDates: readonly string[];
  /** heart measured_at values. */
  heartDates: readonly string[];
  /** meditation sit start days (YYYY-MM-DD, completed sits). */
  meditationDates: readonly string[];
}

/**
 * Union of active calendar days across sources. A date appears once no
 * matter how many actions produced it — the metric counts days, never a
 * blend of unrelated behaviors.
 */
export function collectActiveDates(sources: DisciplineSources): Set<string> {
  const days = new Set<string>();
  for (const v of sources.logDates) {
    const day = sliceDayKey(v);
    if (day) days.add(day);
  }
  for (const v of sources.takenInstants) {
    const day = localDayKeyOfInstant(v);
    if (day) days.add(day);
  }
  for (const v of sources.substanceDates) {
    const day = sliceDayKey(v);
    if (day) days.add(day);
  }
  for (const v of sources.cycleDates) {
    const day = sliceDayKey(v);
    if (day) days.add(day);
  }
  for (const v of sources.heartDates) {
    const day = sliceDayKey(v);
    if (day) days.add(day);
  }
  for (const v of sources.meditationDates) {
    const day = sliceDayKey(v);
    if (day) days.add(day);
  }
  return days;
}

/** True when day lies in the trailing-7-day window ending todayKey. */
export function isInTrailingWeek(day: string, todayKey: string): boolean {
  return day >= shiftDayKey(todayKey, -6) && day <= todayKey;
}

/** Active days inside the trailing-7-day window ending todayKey. */
export function countTrailingWeek(
  activeDates: ReadonlySet<string>,
  todayKey: string,
): number {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (activeDates.has(shiftDayKey(todayKey, -i))) count++;
  }
  return count;
}

/** Active days inside the prior 7-day window (comparison baseline). */
export function countPriorWeek(
  activeDates: ReadonlySet<string>,
  todayKey: string,
): number {
  let count = 0;
  for (let i = 7; i < 14; i++) {
    if (activeDates.has(shiftDayKey(todayKey, -i))) count++;
  }
  return count;
}

/**
 * Consecutive active days ending today — or ending yesterday when today
 * has no action yet (the streak is alive until a full inactive day passes
 * after the last active one; a gap day ends it). Empty → 0. Missing data
 * is absence of activity, never a zero-filled continuation.
 */
export function currentActiveStreak(
  activeDates: ReadonlySet<string>,
  todayKey: string,
): number {
  let cursor = todayKey;
  if (!activeDates.has(cursor)) cursor = shiftDayKey(cursor, -1);
  let streak = 0;
  while (activeDates.has(cursor)) {
    streak++;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

export interface AdherenceResult {
  taken: number;
  total: number;
  percent: number;
}

/**
 * Medication adherence over taken-event statuses: TAKEN counts,
 * MISSED/SKIPPED count against, LATE is excluded (ambiguous) — the same
 * rule as changes.adherencePercent (parity-tested). Null when there is
 * nothing to rate (zero denominator stays null, never 0%).
 */
export function adherenceFromStatuses(statuses: readonly string[]): AdherenceResult | null {
  let taken = 0;
  let missed = 0;
  for (const s of statuses) {
    if (s === 'TAKEN') taken += 1;
    else if (s === 'MISSED' || s === 'SKIPPED') missed += 1;
  }
  const total = taken + missed;
  if (total === 0) return null;
  return { taken, total, percent: Math.round((taken / total) * 100) };
}

/**
 * Descriptive trailing-vs-prior active-day line, e.g.
 * "Active 5 of 7 days · +2 vs prior week". Absolute delta only (mirrors
 * changes.describeChange with mode 'average', usePercent false —
 * parity-tested). Null-safety is the caller's job: both counts are always
 * defined; sparse weeks simply compare small numbers.
 */
export function describeActiveDaysChange(
  currentWeek: number,
  priorWeek: number,
): string {
  const delta = currentWeek - priorWeek;
  if (delta === 0) return `Active ${currentWeek} of 7 days · → 0 vs prior week`;
  const sign = delta > 0 ? '+' : '−';
  return `Active ${currentWeek} of 7 days · ${sign}${Math.abs(delta)} vs prior week`;
}
