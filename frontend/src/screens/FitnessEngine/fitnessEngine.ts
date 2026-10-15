/**
 * fitnessEngine.ts — Fitness Engine pure contract (Batch 6E).
 *
 * Built from the one real fitness source: ACTIVITY_LOG events in daily
 * check-ins (activity_type required at input; duration_minutes and
 * calories_burned user-logged and optional). A session is one logged
 * activity row attributed to its group's log_date (local calendar day).
 *
 * Rules:
 * - sessions count rows; active minutes sum recorded durations only;
 * - a session without a duration contributes no minutes (missing ≠ 0);
 * - averages divide over sessions WITH a duration, never over all rows;
 * - calories are user-logged estimates, reported only as "logged" sums;
 * - distances are user-logged or Health Connect Distance-record sums,
 *   reported only as "logged" sums; pace divides recorded minutes by
 *   recorded km on sessions having both (missing ≠ 0);
 * - period comparison mirrors the shared changes.ts contract
 *   (absolute deltas, null when either side is empty) — parity-tested;
 *   the logic is inlined because node-tested pure modules keep zero
 *   imports.
 *
 * Deliberately absent: composite metrics,
 * aerobic-capacity estimates, training-volume math, recovery estimates,
 * calorie math, targets, predictions, and any composite headline number.
 * Step counts live outside this module (device-only step_counts table,
 * rendered by the screen in a separate card) and never enter the session
 * math below. PPG measurements are intentional measurements, NOT
 * workouts, and never enter this module. Copy is descriptive counts
 * only — never fitter or healthier, never causal.
 *
 * Zero imports: like its sibling engines this module carries its own
 * noon-anchored shiftDayKey (mirroring the canonical @/utils/dayKey so
 * plain-node unit tests run without a bundler alias; keep the two in
 * sync — both are noon-anchored, validated, and return '' on garbage).
 */
function shiftDayKeyCanonical(dayKey: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return '';
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The Batch 6A engine id that activates this engine. */
export const FITNESS_ENGINE_ID = 'fitness';

/** Bounded history window the engine reads (trailing days, inclusive). */
export const FITNESS_HISTORY_DAYS = 28;

/** True when the Fitness Engine is selected in the Batch 6A system. */
export function isFitnessEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(FITNESS_ENGINE_ID);
}

/** One logged activity session: date + type + optional logged values. */
export interface FitnessSession {
  date: string;
  type: string;
  durationMinutes: number | null;
  caloriesLogged: number | null;
  /** Logged or imported km; null when the session has no distance. */
  distanceKm: number | null;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  return shiftDayKeyCanonical(dayKey, deltaDays);
}

/** Earliest date (inclusive) of a trailing-N-day window ending todayKey. */
export function fitnessWindowStart(todayKey: string, days: number = FITNESS_HISTORY_DAYS): string {
  return shiftDayKey(todayKey, -(days - 1));
}

function inTrailing(sessions: readonly FitnessSession[], todayKey: string, back: number): FitnessSession[] {
  const start = shiftDayKey(todayKey, -back);
  return sessions.filter((s) => {
    const day = s.date.slice(0, 10);
    return day >= start && day <= todayKey;
  });
}

/** Sessions in the trailing 7 days (inclusive). */
export function trailingWeekSessions(
  sessions: readonly FitnessSession[],
  todayKey: string,
): FitnessSession[] {
  return inTrailing(sessions, todayKey, 6);
}

/** Sessions in the prior 7 days (comparison baseline). */
export function priorWeekSessions(
  sessions: readonly FitnessSession[],
  todayKey: string,
): FitnessSession[] {
  const start = shiftDayKey(todayKey, -13);
  const end = shiftDayKey(todayKey, -7);
  return sessions.filter((s) => {
    const day = s.date.slice(0, 10);
    return day >= start && day <= end;
  });
}

export interface FitnessSummary {
  /** Logged sessions in the window (rows, regardless of duration). */
  sessions: number;
  /** Sum of recorded durations; null when no session logged one. */
  activeMinutes: number | null;
  /** Mean duration over sessions WITH a duration; null when none. */
  avgMinutes: number | null;
  /** Distinct active days in the window. */
  activeDays: number;
  /** Sum of user-logged calories; null when none logged. */
  caloriesLogged: number | null;
  /** Sum of logged/imported km; null when no session logged one. */
  distanceKm: number | null;
}

/** Summary over the window; nulls (never zeros) where nothing was logged. */
export function summarizeFitness(sessions: readonly FitnessSession[]): FitnessSummary {
  const withDuration = sessions.filter(
    (s) => typeof s.durationMinutes === 'number' && Number.isFinite(s.durationMinutes),
  );
  const minutes = withDuration.map((s) => s.durationMinutes as number);
  const withCalories = sessions.filter(
    (s) => typeof s.caloriesLogged === 'number' && Number.isFinite(s.caloriesLogged),
  );
  const withDistance = sessions.filter(
    (s) => typeof s.distanceKm === 'number' && Number.isFinite(s.distanceKm) && (s.distanceKm as number) > 0,
  );
  return {
    sessions: sessions.length,
    activeMinutes: minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) : null,
    avgMinutes: minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null,
    activeDays: new Set(sessions.map((s) => s.date.slice(0, 10))).size,
    caloriesLogged:
      withCalories.length > 0
        ? (withCalories.map((s) => s.caloriesLogged as number).reduce((a, b) => a + b, 0))
        : null,
    distanceKm:
      withDistance.length > 0
        ? Math.round(withDistance.map((s) => s.distanceKm as number).reduce((a, b) => a + b, 0) * 100) / 100
        : null,
  };
}

/**
 * Minutes per km for one session; null unless both duration and a
 * positive distance were recorded. Descriptive only — never a target.
 */
export function paceMinPerKm(session: Pick<FitnessSession, 'durationMinutes' | 'distanceKm'>): number | null {
  if (
    typeof session.durationMinutes !== 'number' ||
    !Number.isFinite(session.durationMinutes) ||
    typeof session.distanceKm !== 'number' ||
    !Number.isFinite(session.distanceKm) ||
    session.distanceKm <= 0
  ) {
    return null;
  }
  return session.durationMinutes / session.distanceKm;
}

/** "8:24 /km" style pace line; null when pace is unavailable. */
export function formatPace(pace: number | null): string | null {
  if (pace === null || !Number.isFinite(pace)) return null;
  const totalSeconds = Math.round(pace * 60);
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss} /km`;
}

/** "12.4 km" style distance line; null when nothing was logged. */
export function formatDistanceKm(km: number | null): string | null {
  if (km === null || !Number.isFinite(km)) return null;
  return `${Math.round(km * 10) / 10} km`;
}

/**
 * Absolute-delta line for session counts, e.g. "+2 sessions vs prior
 * week", "→ 0 sessions vs prior week". Null when either week is empty —
 * missing history is never a zero baseline. Mirrors
 * changes.describeChange mode 'count', usePercent false (parity-tested).
 */
export function describeSessionsChange(
  current: readonly FitnessSession[],
  previous: readonly FitnessSession[],
  periodLabel = 'vs prior week',
): string | null {
  if (current.length === 0 || previous.length === 0) return null;
  const delta = current.length - previous.length;
  if (delta === 0) return `→ 0 sessions ${periodLabel}`;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'session' : 'sessions'} ${periodLabel}`;
}

/**
 * Absolute-delta line for active minutes, e.g. "+45 min vs prior week".
 * Both sides need at least one recorded duration; otherwise null.
 * Mirrors changes.describeChange mode 'sum', usePercent false
 * (parity-tested).
 */
export function describeMinutesChange(
  current: readonly FitnessSession[],
  previous: readonly FitnessSession[],
  periodLabel = 'vs prior week',
): string | null {
  const sum = (rows: readonly FitnessSession[]): number | null => {
    const minutes = rows
      .map((s) => s.durationMinutes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) : null;
  };
  const cur = sum(current);
  const prev = sum(previous);
  if (cur === null || prev === null) return null;
  const delta = cur - prev;
  const rounded = Math.abs(delta) < 10 ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return `→ 0 min ${periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded)} min ${periodLabel}`;
}

/** One cell of the trailing-7-day sessions strip. */
export interface FitnessWeekDay {
  date: string;
  sessions: number;
}

/** Trailing-7-day per-day session counts (oldest first). */
export function buildFitnessWeek(
  sessions: readonly FitnessSession[],
  todayKey: string,
): FitnessWeekDay[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const day = s.date.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days: FitnessWeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDayKey(todayKey, -i);
    days.push({ date, sessions: counts.get(date) ?? 0 });
  }
  return days;
}

/** "1h 30m" / "45m" — display only, no rounding of stored values. */
export function formatActiveMinutes(totalMinutes: number): string {
  const mins = Math.round(totalMinutes);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h <= 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
