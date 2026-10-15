/**
 * meditation.ts — bell-timed meditation sits (device-only, local-first).
 *
 * Tracking, NOT treatment: record completed sits (preset minutes, actual
 * seconds, optional note) and review real history with totals. No guided
 * content, no claims about stress/mood outcomes, no diagnoses anywhere.
 * Device-only by design (no sync_status, no queue rows) — the UI labels
 * this data accordingly instead of implying server backup.
 *
 * Node-testable by design: logic takes an explicit database handle and this
 * module has zero runtime imports (production entry points resolve the
 * encrypted database lazily).
 */

/** Countdown presets offered by the timer (minutes). */
export const MEDITATION_PRESETS = [5, 10, 15, 20] as const;

export type MeditationPreset = (typeof MEDITATION_PRESETS)[number];

export function isMeditationPreset(value: unknown): value is MeditationPreset {
  return (
    typeof value === 'number' &&
    (MEDITATION_PRESETS as readonly number[]).includes(value)
  );
}

export interface MeditationSession {
  entry_id: string;
  patient_id: string;
  /** Preset chosen at start (minutes). */
  preset_min: number;
  /** Actual elapsed seconds when the sit ended. */
  duration_sec: number;
  /** ISO datetime the sit started. */
  started_at: string;
  /** ISO datetime the sit ended. */
  ended_at: string;
  /** 1 when the countdown reached zero, 0 when ended early. */
  completed: number;
  notes: string | null;
  created_at: string;
}

export interface MeditationDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

export interface NewMeditationSession {
  preset_min: number;
  duration_sec: number;
  started_at: string;
  ended_at: string;
  completed: boolean;
  notes?: string | null;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Validate + normalize a finished sit (throws on invalid input, never stores). */
export function normalizeMeditationInput(input: {
  preset_min: unknown;
  duration_sec: unknown;
  started_at: unknown;
  ended_at: unknown;
  completed: unknown;
  notes?: unknown;
}): NewMeditationSession {
  if (!isMeditationPreset(input.preset_min)) {
    throw new Error('Choose a 5, 10, 15 or 20 minute sit.');
  }
  const durationSec =
    typeof input.duration_sec === 'number' &&
    Number.isFinite(input.duration_sec) &&
    input.duration_sec > 0
      ? Math.floor(input.duration_sec)
      : 0;
  if (durationSec <= 0) {
    throw new Error('A finished sit needs a positive duration.');
  }
  const startedAt =
    input.started_at instanceof Date
      ? input.started_at.toISOString()
      : typeof input.started_at === 'string'
        ? input.started_at
        : '';
  const endedAt =
    input.ended_at instanceof Date
      ? input.ended_at.toISOString()
      : typeof input.ended_at === 'string'
        ? input.ended_at
        : '';
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) {
    throw new Error('A valid start time is required.');
  }
  if (!endedAt || Number.isNaN(new Date(endedAt).getTime())) {
    throw new Error('A valid end time is required.');
  }
  if (new Date(endedAt).getTime() < new Date(startedAt).getTime()) {
    throw new Error('End time cannot be before start time.');
  }
  return {
    preset_min: input.preset_min,
    duration_sec: durationSec,
    started_at: startedAt,
    ended_at: endedAt,
    completed: input.completed === true,
    notes: cleanText(typeof input.notes === 'string' ? input.notes : null, 1000),
  };
}

export async function insertMeditationSessionDb(
  db: MeditationDb,
  patientId: string,
  input: NewMeditationSession,
): Promise<string> {
  const entryId = randomId();
  await db.runAsync(
    `INSERT INTO meditation_sessions
       (entry_id, patient_id, preset_min, duration_sec, started_at,
        ended_at, completed, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    patientId,
    input.preset_min,
    input.duration_sec,
    input.started_at,
    input.ended_at,
    input.completed ? 1 : 0,
    input.notes ?? null,
  );
  return entryId;
}

export async function listMeditationSessionsDb(
  db: MeditationDb,
  patientId: string,
  limit = 200,
): Promise<MeditationSession[]> {
  const rows = await db.getAllAsync<MeditationSession>(
    `SELECT entry_id, patient_id, preset_min, duration_sec, started_at,
            ended_at, completed, notes, created_at
       FROM meditation_sessions
      WHERE patient_id = ?
      ORDER BY started_at DESC
      LIMIT ?`,
    patientId,
    limit,
  );
  return rows;
}

/** Day keys (YYYY-MM-DD) with at least one completed sit, newest first. */
export async function listMeditationDaysDb(
  db: MeditationDb,
  patientId: string,
  limit = 200,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ day: string }>(
    `SELECT DISTINCT substr(started_at, 1, 10) AS day
       FROM meditation_sessions
      WHERE patient_id = ? AND completed = 1
      ORDER BY day DESC
      LIMIT ?`,
    patientId,
    limit,
  );
  return rows.map((r) => r.day);
}

export async function deleteMeditationSessionDb(
  db: MeditationDb,
  patientId: string,
  entryId: string,
): Promise<void> {
  await db.runAsync(
    `DELETE FROM meditation_sessions WHERE patient_id = ? AND entry_id = ?`,
    patientId,
    entryId,
  );
}

export interface MeditationTotals {
  sessions: number;
  completedSessions: number;
  minutes: number;
}

/** Descriptive totals over completed sits only — no streaks, no scores. */
export function summarizeMeditation(sessions: readonly MeditationSession[]): MeditationTotals {
  let completedSessions = 0;
  let seconds = 0;
  for (const s of sessions) {
    if (s.completed === 1) {
      completedSessions += 1;
      seconds += s.duration_sec;
    }
  }
  return {
    sessions: sessions.length,
    completedSessions,
    minutes: Math.floor(seconds / 60),
  };
}

export interface MeditationWeekDay {
  date: string;
  count: number;
}

/**
 * Last-7-day strip ending today (inclusive), ascending. Counts completed
 * sits per calendar day from started_at — descriptive counts only.
 */
export function summarizeMeditationWeek(
  sessions: readonly MeditationSession[],
  today: string,
): MeditationWeekDay[] {
  const day = today.slice(0, 10);
  const base = new Date(`${day}T12:00:00`);
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.completed !== 1) continue;
    const key = String(s.started_at).slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: MeditationWeekDay[] = [];
  for (let back = 6; back >= 0; back--) {
    const d = new Date(base);
    d.setDate(d.getDate() - back);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<MeditationDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as MeditationDb;
}

export async function insertMeditationSession(
  patientId: string,
  input: NewMeditationSession,
): Promise<string> {
  return insertMeditationSessionDb(await getDb(), patientId, input);
}

export async function deleteMeditationSession(
  patientId: string,
  entryId: string,
): Promise<void> {
  return deleteMeditationSessionDb(await getDb(), patientId, entryId);
}

export async function listMeditationSessions(
  patientId: string,
  limit = 200,
): Promise<MeditationSession[]> {
  return listMeditationSessionsDb(await getDb(), patientId, limit);
}

/** Day keys (YYYY-MM-DD) with at least one completed sit, newest first. */
export async function listMeditationDays(
  patientId: string,
  limit = 200,
): Promise<string[]> {
  return listMeditationDaysDb(await getDb(), patientId, limit);
}
