/**
 * heartRate.ts — unified local heart-rate feed over the on-device camera
 * measurement tables (PPG fingertip + RPPG face).
 *
 * The HealthGraph dial reads server aggregates (trends + daily-metrics) and
 * manual-vital streams — none of which contain camera measurements (the
 * backend never merges ppg_measurements into daily-metrics). This module is
 * the SINGLE local aggregation both modalities share (parity, no duplicated
 * logic): one UNION ALL, newest-first, patient-scoped, null-HR rows excluded
 * (hooks never persist failed/insufficient runs, so every row here is a real
 * measured BPM). Provenance (`method`) is preserved so UI/sync can tell
 * fingertip PPG apart from face RPPG.
 *
 * Connection access is lazy (dynamic import) so node unit tests can import
 * this module's pure helpers + SQL delegate without the native SQLite stack.
 */

export type HeartRateMethod = 'ppg' | 'rppg';

export interface LocalHeartRatePoint {
  /** Local row id (ppg_measurements / rppg_measurements primary key). */
  measurementId: string;
  method: HeartRateMethod;
  bpm: number;
  measuredAt: string;
  signalQuality: number;
  /** 1 = reliable, 0 = borderline-but-real (flagged, synced). */
  reliable: number;
}

/** Minimal structural surface of the SQLite handle we need (expo-sqlite). */
export interface HeartRateDb {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

interface HeartRateRow {
  measurement_id: string;
  measured_at: string;
  heart_rate_bpm: number;
  signal_quality: number;
  reliable: number;
}

/**
 * Production SQL (single source — the delegate below executes exactly this).
 * UNION ALL keeps both modalities without a second query; patient scoping is
 * in each leg so no cross-user row can ever leak into the feed.
 */
export const RECENT_HEART_RATES_SQL = `
  SELECT measurement_id, measured_at, heart_rate_bpm, signal_quality, reliable, 'ppg' AS method
  FROM ppg_measurements
  WHERE patient_id = ? AND heart_rate_bpm IS NOT NULL
  UNION ALL
  SELECT measurement_id, measured_at, heart_rate_bpm, signal_quality, reliable, 'rppg' AS method
  FROM rppg_measurements
  WHERE patient_id = ? AND heart_rate_bpm IS NOT NULL
  ORDER BY measured_at DESC LIMIT ?
`;

/** Execute the unified feed against an explicit handle (test seam). */
export async function queryRecentLocalHeartRates(
  db: HeartRateDb,
  patientId: string,
  limit = 30,
): Promise<LocalHeartRatePoint[]> {
  const rows = await db.getAllAsync<HeartRateRow & { method: string }>(
    RECENT_HEART_RATES_SQL,
    patientId,
    patientId,
    Math.max(1, Math.min(200, Math.floor(limit))),
  );
  const out: LocalHeartRatePoint[] = [];
  for (const r of rows) {
    if (r.method !== 'ppg' && r.method !== 'rppg') continue;
    if (typeof r.heart_rate_bpm !== 'number' || !Number.isFinite(r.heart_rate_bpm)) continue;
    out.push({
      measurementId: String(r.measurement_id),
      method: r.method,
      bpm: r.heart_rate_bpm,
      measuredAt: String(r.measured_at),
      signalQuality: typeof r.signal_quality === 'number' ? r.signal_quality : 0,
      reliable: r.reliable === 1 ? 1 : 0,
    });
  }
  return out;
}

/** Production entry point: opens the encrypted DB, then delegates. */
export async function getRecentLocalHeartRates(
  patientId: string,
  limit = 30,
): Promise<LocalHeartRatePoint[]> {
  const { getDatabase } = await import('@/db/connection');
  const db = await getDatabase();
  return queryRecentLocalHeartRates(
    db as unknown as HeartRateDb,
    patientId,
    limit,
  );
}

export interface HeartDayPoint {
  /** YYYY-MM-DD calendar day. */
  date: string;
  value: number;
  /** Full ISO timestamp of the winning measurement (tie-breaks). */
  time: string;
  method: HeartRateMethod;
}

/**
 * Collapse feed rows to one point per calendar day for the dial scrubber.
 * Latest measurement of the day wins (a fresh camera reading supersedes an
 * older same-day value). Ascending by date — the dial's carry-forward and
 * trend math consume this shape directly.
 */
export function toHeartDayPoints(rows: LocalHeartRatePoint[]): HeartDayPoint[] {
  const byDay = new Map<string, HeartDayPoint>();
  const sorted = [...rows].sort((a, b) =>
    a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0,
  );
  for (const r of sorted) {
    const date = r.measuredAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDay.set(date, { date, value: r.bpm, time: r.measuredAt, method: r.method });
  }
  return [...byDay.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * Merge camera day-points into an existing 'hr' day series. Camera wins
 * same-day ties (it is the freshest on-device truth); purely-server days are
 * preserved untouched. Returns ascending points in dial-stream shape.
 */
export function mergeHeartRateSeries(
  existing: Array<{ date: string; value: number }>,
  camera: HeartDayPoint[],
): Array<{ date: string; value: number }> {
  const merged = new Map<string, number>();
  for (const p of existing) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value)) {
      merged.set(p.date, p.value);
    }
  }
  for (const p of camera) merged.set(p.date, p.value);
  return [...merged.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
