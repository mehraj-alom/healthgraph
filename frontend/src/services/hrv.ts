/**
 * hrv.ts — on-device HRV math (zero imports).
 *
 * rMSSD + SDNN from camera-derived beat intervals in milliseconds, with
 * Task-Force-style gating: physiologically impossible intervals dropped,
 * >20% successive jumps rejected as ectopy/artifacts, and short reads
 * (<10 valid beats) gated to null rather than scored. Baselines are a
 * 7-day mean with a 60-day observed min–max band, minimum four readings.
 * Values are wellness readouts — never interpreted as medical findings,
 * never graded.
 *
 * Node-testable by design.
 */

export const MIN_VALID_BEATS = 10;
const MIN_INTERVAL_MS = 300;
const MAX_INTERVAL_MS = 2000;
const MAX_SUCCESSIVE_JUMP = 0.2;
const BASELINE_WINDOW_DAYS = 7;
const BASELINE_BAND_DAYS = 60;
const BASELINE_MIN_READINGS = 4;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Valid beat intervals: finite, in range, no ectopic jumps (each beat
 * compared against the last accepted beat, not against dropped ones).
 */
export function cleanRrIntervals(intervals: ReadonlyArray<unknown>): number[] {
  const out: number[] = [];
  for (const raw of intervals) {
    const v = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v < MIN_INTERVAL_MS || v > MAX_INTERVAL_MS) continue;
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (Math.abs(v - prev) / prev > MAX_SUCCESSIVE_JUMP) continue;
    }
    out.push(v);
  }
  return out;
}

/** rMSSD in ms, or null when too few valid beats. */
export function rmssd(intervalsMs: ReadonlyArray<unknown>): number | null {
  const beats = cleanRrIntervals(intervalsMs);
  if (beats.length < MIN_VALID_BEATS) return null;
  let sumSq = 0;
  for (let i = 1; i < beats.length; i++) {
    const diff = beats[i] - beats[i - 1];
    sumSq += diff * diff;
  }
  return round1(Math.sqrt(sumSq / (beats.length - 1)));
}

/** SDNN in ms, or null when too few valid beats. */
export function sdnn(intervalsMs: ReadonlyArray<unknown>): number | null {
  const beats = cleanRrIntervals(intervalsMs);
  if (beats.length < MIN_VALID_BEATS) return null;
  const mean = beats.reduce((s, v) => s + v, 0) / beats.length;
  const variance = beats.reduce((s, v) => s + (v - mean) * (v - mean), 0) / beats.length;
  return round1(Math.sqrt(variance));
}

export interface HrvReading {
  measured_at: unknown;
  rmssd_ms: unknown;
}

export interface HrvBaseline {
  /** Readings inside the 7-day window. */
  count: number;
  /** 7-day mean rMSSD in ms. */
  mean: number;
  /** Observed min/max over the 60-day band. */
  lo: number;
  hi: number;
}

function validRmssd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function dayOf(measuredAt: unknown): string | null {
  if (typeof measuredAt !== 'string') return null;
  const day = measuredAt.slice(0, 10);
  return DAY_RE.test(day) ? day : null;
}

function shiftDay(dayKey: string, deltaDays: number): string | null {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Morning baseline from stored rMSSD readings: 7-day mean plus the
 * observed 60-day band. Null when fewer than four in-window readings —
 * thin history shows nothing, never a band of one.
 */
export function hrvBaseline(
  readings: ReadonlyArray<HrvReading>,
  todayKey: string,
): HrvBaseline | null {
  const end = typeof todayKey === 'string' ? todayKey.slice(0, 10) : '';
  if (!DAY_RE.test(end)) return null;
  const windowStart = shiftDay(end, -(BASELINE_WINDOW_DAYS - 1));
  const bandStart = shiftDay(end, -(BASELINE_BAND_DAYS - 1));
  if (windowStart === null || bandStart === null) return null;
  const inWindow: number[] = [];
  const inBand: number[] = [];
  for (const r of readings) {
    const day = dayOf(r.measured_at);
    if (day === null || !validRmssd(r.rmssd_ms) || day > end) continue;
    if (day >= bandStart) inBand.push(r.rmssd_ms);
    if (day >= windowStart) inWindow.push(r.rmssd_ms);
  }
  if (inWindow.length < BASELINE_MIN_READINGS) return null;
  const mean = inWindow.reduce((s, v) => s + v, 0) / inWindow.length;
  return {
    count: inWindow.length,
    mean: round1(mean),
    lo: round1(Math.min(...inBand)),
    hi: round1(Math.max(...inBand)),
  };
}
