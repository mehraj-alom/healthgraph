/**
 * recovery.ts — overnight-recovery hint from the user's own baseline
 * (pure, zero imports, node-testable).
 *
 * A wellness hint, never a diagnosis: last night's sleep, resting-pulse
 * drift, HRV drift, and recent load are each weighted against the user's
 * trailing-28-day baseline and combined 40/30/20/10 (HRV absent →
 * 50/40/0/10). Nulls propagate — sparse data yields "need more data",
 * never a fabricated number.
 */

export interface SleepInput {
  date: string;
  durationMinutes: number;
  quality: number | null;
}

export interface HrInput {
  measuredAt: string;
  bpm: number;
}

export interface HrvInput {
  measuredAt: string;
  rmssdMs: number;
}

export interface ActivityInput {
  log_date: string;
  duration_minutes: number | null;
}

export type ReadinessBand = 'ready' | 'steady' | 'easy';

export interface FactorPoints {
  key: 'sleep' | 'resting' | 'hrv' | 'load';
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface Readiness {
  value: number;
  band: ReadinessBand;
  factors: FactorPoints[];
  baselineNights: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

export function bandFor(value: number): ReadinessBand {
  if (value >= 75) return 'ready';
  if (value >= 50) return 'steady';
  return 'easy';
}

export interface ReadinessInput {
  nights: readonly SleepInput[];
  hr: readonly HrInput[];
  hrv: readonly HrvInput[];
  activity: readonly ActivityInput[];
}

/**
 * Compute readiness for todayKey, or report what's missing. Thresholds:
 * a sleep night within the last 3 days, >= 5 nights in 28d, HR readings
 * on >= 3 distinct days. HRV is optional (weights redistribute).
 */
export function computeReadiness(
  input: ReadinessInput,
  todayKey: string,
): { readiness: Readiness | null; missing: string[] } {
  const missing: string[] = [];
  const today = todayKey.slice(0, 10);

  const nights = input.nights
    .filter((n) => Number.isFinite(n.durationMinutes) && n.durationMinutes > 0 && dayOf(n.date) <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const latestNight = nights.length > 0 ? nights[nights.length - 1] : null;
  const latestAge = latestNight ? daysBetween(dayOf(latestNight.date), today) : null;
  if (!latestNight || (latestAge ?? 99) > 3) missing.push('Log last night’s sleep');
  if (nights.length < 5) missing.push(`${Math.max(0, 5 - nights.length)} more sleep nights`);

  // Daily minimum HR per day (resting estimate from lowest readings).
  const minimaByDay = new Map<string, number>();
  for (const p of input.hr) {
    if (!Number.isFinite(p.bpm) || p.bpm <= 0) continue;
    const day = dayOf(p.measuredAt);
    if (!day || day > today) continue;
    const prev = minimaByDay.get(day);
    if (prev == null || p.bpm < prev) minimaByDay.set(day, p.bpm);
  }
  const hrDays = minimaByDay.size;
  if (hrDays < 3) missing.push(`Pulse readings on ${Math.max(0, 3 - hrDays)} more days`);

  if (missing.length > 0) return { readiness: null, missing };

  const factors: FactorPoints[] = [];

  // — Sleep (40, or 50 without HRV): duration vs 7.5h blended with quality.
  const sleepMax = 40;
  const durPart = clamp01((latestNight as SleepInput).durationMinutes / 450);
  const q = (latestNight as SleepInput).quality;
  const qualPart = q == null ? 0.5 : clamp01((q - 1) / 4);
  const sleepPts = (0.7 * durPart + 0.3 * qualPart) * sleepMax;
  factors.push({
    key: 'sleep',
    label: 'Sleep',
    points: Math.round(sleepPts),
    max: sleepMax,
    note: `${Math.round((latestNight as SleepInput).durationMinutes / 60)}h ${Math.round((latestNight as SleepInput).durationMinutes % 60)}m last night`,
  });

  // — Resting pulse (30, or 40 without HRV): latest daily minimum vs
  // the median of previous minima. Lower-or-stable reads higher.
  const restingMax = 30;
  const sortedDays = [...minimaByDay.keys()].sort();
  const latestDay = sortedDays[sortedDays.length - 1];
  const latestMin = minimaByDay.get(latestDay) as number;
  const baselineMin = median(sortedDays.slice(0, -1).map((d) => minimaByDay.get(d) as number)) ?? latestMin;
  const restingPts = clamp01(0.5 + (baselineMin - latestMin) / 10) * restingMax;
  const drift = Math.round(latestMin - baselineMin);
  factors.push({
    key: 'resting',
    label: 'Resting pulse',
    points: Math.round(restingPts),
    max: restingMax,
    note:
      drift === 0
        ? 'steady vs your baseline'
        : drift < 0
          ? `${Math.abs(drift)} bpm below baseline`
          : `${drift} bpm above baseline`,
  });

  // — HRV (20, optional): latest RMSSD vs median baseline.
  const hrvVals = input.hrv
    .filter((h) => Number.isFinite(h.rmssdMs) && h.rmssdMs > 0 && dayOf(h.measuredAt) <= today)
    .sort((a, b) => (a.measuredAt < b.measuredAt ? -1 : 1));
  if (hrvVals.length >= 2) {
    const latestHrv = hrvVals[hrvVals.length - 1].rmssdMs;
    const baseHrv = median(hrvVals.slice(0, -1).map((h) => h.rmssdMs)) ?? latestHrv;
    const ratio = baseHrv > 0 ? latestHrv / baseHrv : 1;
    const hrvPts = clamp01((ratio - 0.7) / 0.6) * 20;
    factors.push({
      key: 'hrv',
      label: 'HRV',
      points: Math.round(hrvPts),
      max: 20,
      note: ratio >= 1 ? 'at or above baseline' : `${Math.round((1 - ratio) * 100)}% below baseline`,
    });
  } else {
    // No HRV yet: its weight flows to sleep (+10) and resting (+10).
    const s = factors.find((f) => f.key === 'sleep');
    const r = factors.find((f) => f.key === 'resting');
    if (s) { s.max = 50; s.points = Math.round(s.points * 1.25); }
    if (r) { r.max = 40; r.points = Math.round(r.points * (40 / 30)); }
  }

  // — Load (10): active days in the trailing 7 (4+ is full).
  const activeDays = new Set<string>();
  for (const a of input.activity) {
    const day = dayOf(a.log_date);
    if (!day || day > today) continue;
    if (daysBetween(day, today) > 6) continue;
    if (a.duration_minutes != null && a.duration_minutes > 0) activeDays.add(day);
  }
  const loadPts = Math.min(activeDays.size / 4, 1) * 10;
  factors.push({
    key: 'load',
    label: 'Load',
    points: Math.round(loadPts),
    max: 10,
    note: `${activeDays.size} active ${activeDays.size === 1 ? 'day' : 'days'} this week`,
  });

  const value = Math.max(0, Math.min(100, Math.round(factors.reduce((s, f) => s + f.points, 0))));
  return {
    readiness: { value, band: bandFor(value), factors, baselineNights: nights.length },
    missing: [],
  };
}
