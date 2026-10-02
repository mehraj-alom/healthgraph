/**
 * stepCounts.ts — device-only Health Connect daily step totals.
 *
 * One row per patient per day; re-imports keep the max (monotonic, never
 * double-counted, never zero-filled). Device-local only: no sync_status
 * column, no queue rows — the UI labels this data accordingly.
 *
 * Connection access is lazy (dynamic import) so node unit tests can import
 * this module's seam functions without the native SQLite stack — same
 * pattern as heartRate.ts.
 */

export interface StepCountsDb {
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

export interface StepHistoryPoint {
  log_date: string;
  steps: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STEPS = 300000;

function assertStepDay(logDate: string, steps: number): void {
  if (typeof logDate !== 'string' || !DAY_RE.test(logDate.slice(0, 10))) {
    throw new Error('step_counts: invalid log_date');
  }
  if (!Number.isInteger(steps) || steps < 0 || steps > MAX_STEPS) {
    throw new Error('step_counts: invalid steps');
  }
}

/** Monotonic upsert against an explicit handle (test seam + production body). */
export async function upsertStepDay(
  db: StepCountsDb,
  patientId: string,
  logDate: string,
  steps: number,
): Promise<void> {
  if (typeof patientId !== 'string' || patientId.length === 0) {
    throw new Error('step_counts: patient required');
  }
  assertStepDay(logDate, steps);
  const day = logDate.slice(0, 10);
  await db.runAsync(
    `INSERT INTO step_counts (patient_id, log_date, steps, source, updated_at)
     VALUES (?, ?, ?, 'health_connect', datetime('now'))
     ON CONFLICT(patient_id, log_date) DO UPDATE SET
       steps = CASE WHEN excluded.steps > step_counts.steps THEN excluded.steps ELSE step_counts.steps END,
       updated_at = datetime('now')`,
    [patientId, day, steps],
  );
}

/** Bounded history, oldest first, patient-scoped (test seam + production body). */
export async function getStepHistory(
  db: StepCountsDb,
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<StepHistoryPoint[]> {
  const rows = await db.getAllAsync<{ log_date: string; steps: number }>(
    `SELECT log_date, steps FROM step_counts
     WHERE patient_id = ? AND log_date >= ? AND log_date <= ?
     ORDER BY log_date ASC`,
    [patientId, startDate, endDate],
  );
  return rows
    .filter((r) => DAY_RE.test(r.log_date) && Number.isInteger(r.steps) && r.steps >= 0)
    .map((r) => ({ log_date: r.log_date, steps: r.steps }));
}

// ─── Production wrappers (lazy connection; never called in node tests) ───

export async function upsertLocalStepDay(
  patientId: string,
  logDate: string,
  steps: number,
): Promise<void> {
  const { getDatabase } = await import('@/db/connection');
  const db = await getDatabase();
  return upsertStepDay(db, patientId, logDate, steps);
}

export async function getLocalStepHistory(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<StepHistoryPoint[]> {
  const { getDatabase } = await import('@/db/connection');
  const db = await getDatabase();
  return getStepHistory(db, patientId, startDate, endDate);
}
