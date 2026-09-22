/**
 * heartEngine.ts — Heart Engine pure contract (Batch 6H, final engine).
 *
 * Built ONLY from persisted camera measurements: fingertip PPG and face
 * RPPG rows (measured_at, heart_rate_bpm, signal_quality, reliable) via
 * the canonical unified feed, plus PPG-only HRV scalars (rmssd_ms,
 * sdnn_ms — persisted only when the capture gate passes: ≥30 s, ≥5 RR
 * intervals, reliable). A null-HR row is never a measurement; hooks never
 * persist failed runs, so every input row here is a real measured BPM.
 *
 * Rules:
 * - averages divide over measured rows, never over calendar days;
 * - missing stays missing (null, never zero);
 * - reliable=0 rows are borderline-but-real and stay in averages (the
 *   dial and hub do the same); reliable share is reported as provenance;
 * - PPG and RPPG are never silently merged: the latest value and recent
 *   history carry their method; the average is explicitly over the
 *   combined camera feed (same rule as the dial/hub);
 * - period comparison mirrors the shared changes.ts contract
 *   (absolute bpm/ms deltas, null when either side is empty) —
 *   parity-tested; the logic is inlined because node-tested pure
 *   modules keep zero imports.
 *
 * Deliberately absent: a rest-state label (no source defines one —
 * ordinary camera readings never carry it), oxygen-saturation cards (no
 * column, no UI), min/max-as-range (spot readings are not a range),
 * stress/recovery/fitness derivations, disease inference, and any cardiovascular headline
 * number. Copy reports measured values only — never healthy or risky,
 * never causal.
 *
 * Zero imports: safe for node unit tests.
 */

/** The Batch 6A engine id that activates this engine. */
export const HEART_ENGINE_ID = 'heart';

/** Bounded feed depth the engine reads (newest-first rows). */
export const HEART_FEED_LIMIT = 60;

/** Measurement modality — preserved on every value, never merged away. */
export type HeartMethod = 'ppg' | 'rppg';

/** One measured heart-rate row from the canonical unified feed. */
export interface HeartPoint {
  measuredAt: string;
  bpm: number;
  method: HeartMethod;
  signalQuality: number;
  /** 1 = reliable, 0 = borderline-but-real. */
  reliable: number;
}

/** One persisted PPG HRV row (fingertip only, gated at capture). */
export interface HrvPoint {
  measuredAt: string;
  rmssdMs: number;
  sdnnMs: number | null;
}

/** True when the Heart Engine is selected in the Batch 6A system. */
export function isHeartEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(HEART_ENGINE_ID);
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local calendar-day slice (measured_at contract, same as the dial). */
export function heartDayKey(measuredAt: string): string | null {
  if (typeof measuredAt !== 'string' || measuredAt.length < 10) return null;
  const day = measuredAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Newest measurement, or null when no rows exist. */
export function latestHeartPoint(points: readonly HeartPoint[]): HeartPoint | null {
  let latest: HeartPoint | null = null;
  for (const p of points) {
    if (latest === null || p.measuredAt > latest.measuredAt) latest = p;
  }
  return latest;
}

/** Points inside the trailing 7 days (inclusive of todayKey). */
export function trailingWeekHeart(
  points: readonly HeartPoint[],
  todayKey: string,
): HeartPoint[] {
  const start = shiftDayKey(todayKey, -6);
  return points.filter((p) => {
    const day = heartDayKey(p.measuredAt);
    return day !== null && day >= start && day <= todayKey;
  });
}

/** Points inside the prior 7 days (comparison baseline). */
export function priorWeekHeart(
  points: readonly HeartPoint[],
  todayKey: string,
): HeartPoint[] {
  const start = shiftDayKey(todayKey, -13);
  const end = shiftDayKey(todayKey, -7);
  return points.filter((p) => {
    const day = heartDayKey(p.measuredAt);
    return day !== null && day >= start && day <= end;
  });
}

export interface HeartSummary {
  /** Measured rows in the window. */
  measurements: number;
  /** Mean BPM over measured rows; null when none. */
  avgBpm: number | null;
  /** Distinct measured days in the window. */
  measuredDays: number;
  /** Reliable rows in the window (provenance, not a filter). */
  reliableCount: number;
}

/** Summary over the window; nulls (never zeros) where nothing was measured. */
export function summarizeHeart(points: readonly HeartPoint[]): HeartSummary {
  if (points.length === 0) {
    return { measurements: 0, avgBpm: null, measuredDays: 0, reliableCount: 0 };
  }
  const sum = points.reduce((s, p) => s + p.bpm, 0);
  return {
    measurements: points.length,
    avgBpm: sum / points.length,
    measuredDays: new Set(
      points.map((p) => heartDayKey(p.measuredAt)).filter((d): d is string => d !== null),
    ).size,
    reliableCount: points.filter((p) => p.reliable === 1).length,
  };
}

/**
 * Absolute-delta line for average BPM, e.g. "Average HR +3 bpm vs prior
 * week". Null when either week has no measurement. Mirrors
 * changes.describeChange mode 'average', unit 'bpm', usePercent false
 * (parity-tested). Direction is a number, never a health judgment.
 */
export function describeHeartChange(
  current: readonly HeartPoint[],
  previous: readonly HeartPoint[],
  periodLabel = 'vs prior week',
): string | null {
  if (current.length === 0 || previous.length === 0) return null;
  const curAvg = current.reduce((s, p) => s + p.bpm, 0) / current.length;
  const prevAvg = previous.reduce((s, p) => s + p.bpm, 0) / previous.length;
  const delta = curAvg - prevAvg;
  const rounded = Math.abs(delta) < 10 ? Math.round(delta * 10) / 10 : Math.round(delta);
  if (rounded === 0) return `Average HR → 0 bpm ${periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  return `Average HR ${sign}${Math.abs(rounded)} bpm ${periodLabel}`;
}

export interface HrvSummary {
  /** PPG sessions with a persisted RMSSD. */
  sessions: number;
  /** Newest HRV row, or null when none exists. */
  latest: HrvPoint | null;
  /** Mean RMSSD over sessions; null when none. */
  avgRmssdMs: number | null;
}

/** HRV summary; nulls (never zeros) when no PPG session stored HRV. */
export function summarizeHrv(points: readonly HrvPoint[]): HrvSummary {
  if (points.length === 0) return { sessions: 0, latest: null, avgRmssdMs: null };
  let latest = points[0];
  for (const p of points) {
    if (p.measuredAt > latest.measuredAt) latest = p;
  }
  const sum = points.reduce((s, p) => s + p.rmssdMs, 0);
  return { sessions: points.length, latest, avgRmssdMs: sum / points.length };
}

/** "72 bpm" — display only, rounded. */
export function formatBpm(bpm: number): string {
  return `${Math.round(bpm)} bpm`;
}

/** "42 ms" — display only, unit-preserving. */
export function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

/** "Sep 20, 08:31" — local display of a measurement instant. */
export function formatMeasuredAt(measuredAt: string): string {
  const d = new Date(measuredAt);
  if (Number.isNaN(d.getTime())) return measuredAt.slice(0, 10);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** "Fingertip PPG" / "Face RPPG" — human modality provenance. */
export function methodLabel(method: HeartMethod): string {
  return method === 'ppg' ? 'Fingertip PPG' : 'Face RPPG';
}
