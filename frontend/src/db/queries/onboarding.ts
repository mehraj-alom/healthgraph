/**
 * onboarding.ts — per-patient onboarding personalization state (SQLite).
 *
 * One row per patient: completion flag + goals/focus selections as JSON
 * arrays of stable option ids. Device-local only (never synced — there is
 * no backend onboarding surface). Patient_id primary key keeps selections
 * isolated across accounts on shared devices.
 *
 * Node-testable by design: the wipe/read/write logic takes an explicit
 * database handle (queryOnboardingState etc.) and this module has zero
 * runtime imports; the production entry points resolve the encrypted
 * database lazily — same pattern as heartRate.ts.
 */

export interface OnboardingRow {
  patient_id: string;
  completed: number;
  goals_json: string;
  focus_json: string;
  updated_at: string;
}

export interface OnboardingState {
  completed: boolean;
  goals: string[];
  focus: string[];
}

/** Minimal structural surface of the SQLite handle we need. */
export interface OnboardingDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

function parseIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function rowToState(row: OnboardingRow | null): OnboardingState | null {
  if (!row) return null;
  return {
    completed: row.completed === 1,
    goals: parseIds(row.goals_json),
    focus: parseIds(row.focus_json),
  };
}

/** Read one patient's onboarding row (test seam over an explicit handle). */
export async function queryOnboardingState(
  db: OnboardingDb,
  patientId: string,
): Promise<OnboardingState | null> {
  const row = await db.getFirstAsync<OnboardingRow>(
    'SELECT patient_id, completed, goals_json, focus_json, updated_at ' +
      'FROM onboarding_state WHERE patient_id = ?',
    patientId,
  );
  return rowToState(row);
}

/** Upsert selections (never touches the completion flag). */
export async function saveOnboardingSelectionsDb(
  db: OnboardingDb,
  patientId: string,
  goals: string[],
  focus: string[],
): Promise<void> {
  await db.runAsync(
    `INSERT INTO onboarding_state (patient_id, completed, goals_json, focus_json, updated_at)
     VALUES (?, 0, ?, ?, datetime('now'))
     ON CONFLICT(patient_id) DO UPDATE SET
       goals_json = excluded.goals_json,
       focus_json = excluded.focus_json,
       updated_at = excluded.updated_at`,
    patientId,
    JSON.stringify(goals),
    JSON.stringify(focus),
  );
}

/** Mark the flow complete (preserves selections). */
export async function markOnboardingCompleteDb(
  db: OnboardingDb,
  patientId: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO onboarding_state (patient_id, completed, goals_json, focus_json, updated_at)
     VALUES (?, 1, '[]', '[]', datetime('now'))
     ON CONFLICT(patient_id) DO UPDATE SET
       completed = 1,
       updated_at = excluded.updated_at`,
    patientId,
  );
}

export interface PriorityIntroState {
  /** Setup completed (fresh or grandfathered). */
  completed: boolean;
  /** Lifetime exposures shown (0–3, never above). */
  count: number;
  /** Local calendar day of the last exposure (YYYY-MM-DD) or null. */
  lastDate: string | null;
}

/**
 * Read one patient's Priority intro exposure (test seam over an explicit
 * handle). Tolerates pre-migration rows (missing columns select as null
 * via COALESCE-safe access — the query names columns explicitly and the
 * migration guarantees them; a missing row yields zero state).
 */
export async function queryPriorityIntroDb(
  db: OnboardingDb,
  patientId: string,
): Promise<PriorityIntroState> {
  const row = await db.getFirstAsync<{
    completed: number;
    priority_intro_count: number | null;
    priority_intro_last_date: string | null;
  }>(
    'SELECT completed, priority_intro_count, priority_intro_last_date ' +
      'FROM onboarding_state WHERE patient_id = ?',
    patientId,
  );
  if (!row) return { completed: false, count: 0, lastDate: null };
  const count =
    typeof row.priority_intro_count === 'number' && Number.isFinite(row.priority_intro_count)
      ? Math.max(0, Math.min(3, Math.floor(row.priority_intro_count)))
      : 0;
  return {
    completed: row.completed === 1,
    count,
    lastDate: typeof row.priority_intro_last_date === 'string' ? row.priority_intro_last_date : null,
  };
}

/**
 * Record a Priority intro exposure: count+1 (capped at 3) stamped with
 * the local calendar day. Touches ONLY the exposure columns — goals,
 * focus, and completion are never modified here, and health history is
 * never touched. No-op when the row does not exist (exposures only ever
 * happen post-gate, where the row is guaranteed).
 */
export async function recordPriorityIntroDb(
  db: OnboardingDb,
  patientId: string,
  count: number,
  date: string,
): Promise<void> {
  const capped = Math.max(0, Math.min(3, Math.floor(count)));
  await db.runAsync(
    `UPDATE onboarding_state
     SET priority_intro_count = ?, priority_intro_last_date = ?, updated_at = datetime('now')
     WHERE patient_id = ?`,
    capped,
    date,
    patientId,
  );
}

/**
 * True when the patient has ANY local health data (daily logs, medications,
 * or camera measurements). Used to grandfather established users past the
 * setup flow: someone with real data was clearly onboarded before this
 * feature existed, so setup must never interrupt them.
 */
export async function hasLocalHealthDataDb(db: OnboardingDb, patientId: string): Promise<boolean> {
  const checks = [
    'SELECT 1 FROM daily_logs WHERE patient_id = ? LIMIT 1',
    'SELECT 1 FROM medications WHERE patient_id = ? LIMIT 1',
    'SELECT 1 FROM ppg_measurements WHERE patient_id = ? LIMIT 1',
    'SELECT 1 FROM rppg_measurements WHERE patient_id = ? LIMIT 1',
  ];
  for (const sql of checks) {
    const row = await db.getFirstAsync<unknown>(sql, patientId);
    if (row !== null) return true;
  }
  return false;
}

export interface GateResolution {
  /** True when the setup flow must be shown. */
  needed: boolean;
  /** True when an established user was auto-completed (never interrupt). */
  grandfathered: boolean;
}

/**
 * Pure gate decision from a row + data presence (unit-testable; the hook
 * below supplies the inputs from SQLite).
 */
export function resolveOnboardingGate(
  row: OnboardingState | null,
  hasData: boolean,
): GateResolution {
  if (row?.completed) return { needed: false, grandfathered: false };
  if (hasData) return { needed: false, grandfathered: true };
  return { needed: true, grandfathered: false };
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<OnboardingDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as OnboardingDb;
}

/** Read one patient's onboarding state. */
export async function getOnboardingState(patientId: string): Promise<OnboardingState | null> {
  return queryOnboardingState(await getDb(), patientId);
}

/** Persist goals/focus selections for a patient. */
export async function saveOnboardingSelections(
  patientId: string,
  goals: string[],
  focus: string[],
): Promise<void> {
  return saveOnboardingSelectionsDb(await getDb(), patientId, goals, focus);
}

/** Mark the setup flow complete for a patient. */
export async function markOnboardingComplete(patientId: string): Promise<void> {
  return markOnboardingCompleteDb(await getDb(), patientId);
}

/** Read one patient's Priority intro exposure. */
export async function getPriorityIntro(patientId: string): Promise<PriorityIntroState> {
  return queryPriorityIntroDb(await getDb(), patientId);
}

/** Record one Priority intro exposure for a patient. */
export async function recordPriorityIntro(
  patientId: string,
  count: number,
  date: string,
): Promise<void> {
  return recordPriorityIntroDb(await getDb(), patientId, count, date);
}

/**
 * Resolve whether the setup flow must be shown, grandfathering established
 * users (writes the completion row for them so the check stays cheap).
 */
export async function resolveOnboardingGateDb(patientId: string): Promise<GateResolution> {
  const db = await getDb();
  const row = await queryOnboardingState(db, patientId);
  if (row?.completed) return { needed: false, grandfathered: false };
  const hasData = await hasLocalHealthDataDb(db, patientId);
  const resolved = resolveOnboardingGate(row, hasData);
  if (resolved.grandfathered) {
    await markOnboardingCompleteDb(db, patientId);
  }
  return resolved;
}
