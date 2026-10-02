/**
 * cravings.ts — neutral craving/trigger logging (device-only, local-first).
 *
 * Rows record when a craving happened, an optional trigger, an optional
 * 1-5 intensity, and an optional passed/used outcome — all user-entered,
 * stored verbatim. Summaries count rows only, always with the window
 * attached; thin history yields honest empty, never patterns.
 * Device-only by design (no sync_status, no queue rows) — the UI labels
 * this data accordingly instead of implying server backup.
 *
 * Node-testable by design: logic takes an explicit database handle and this
 * module has zero runtime imports (production entry points resolve the
 * encrypted database lazily).
 */

import type { SubstanceCategory } from './substances';

export const CRAVING_TRIGGERS = [
  'stress',
  'social',
  'boredom',
  'routine',
  'mood',
  'reminder',
  'other',
] as const;

export type CravingTrigger = (typeof CRAVING_TRIGGERS)[number];

export type CravingOutcome = 'passed' | 'used';

const TRIGGER_LABELS: Record<CravingTrigger, string> = {
  stress: 'Stress',
  social: 'With others',
  boredom: 'Boredom',
  routine: 'Part of routine',
  mood: 'Low mood',
  reminder: 'Reminder nearby',
  other: 'Other',
};

export function isCravingTrigger(value: unknown): value is CravingTrigger {
  return (
    typeof value === 'string' &&
    (CRAVING_TRIGGERS as readonly string[]).includes(value)
  );
}

export function triggerLabel(trigger: CravingTrigger): string {
  return TRIGGER_LABELS[trigger];
}

export interface CravingEntry {
  entry_id: string;
  patient_id: string;
  category: SubstanceCategory;
  trigger: CravingTrigger | null;
  /** ISO datetime of the craving. */
  occurred_at: string;
  /** Optional 1-5 intensity, user-entered. */
  intensity: number | null;
  /** Optional outcome: craving passed, or use followed. */
  outcome: CravingOutcome | null;
  notes: string | null;
  created_at: string;
}

export interface CravingDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

export interface NewCravingEntry {
  category: SubstanceCategory;
  trigger?: CravingTrigger | null;
  occurred_at: string;
  intensity?: number | null;
  outcome?: CravingOutcome | null;
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

/** Intensity is user-entered 1-5; anything else stays null, never coerced. */
function cleanIntensity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 5) return null;
  return value;
}

function isOutcome(value: unknown): value is CravingOutcome {
  return value === 'passed' || value === 'used';
}

/** Validate + normalize a new entry (throws on invalid input, never stores). */
export function normalizeCravingInput(input: {
  category: unknown;
  trigger?: unknown;
  occurred_at: unknown;
  intensity?: unknown;
  outcome?: unknown;
  notes?: unknown;
}): NewCravingEntry {
  if (
    input.category !== 'alcohol' &&
    input.category !== 'tobacco' &&
    input.category !== 'other'
  ) {
    throw new Error('Choose alcohol, tobacco, or other.');
  }
  const occurredAt =
    input.occurred_at instanceof Date
      ? input.occurred_at.toISOString()
      : typeof input.occurred_at === 'string'
        ? input.occurred_at
        : '';
  if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) {
    throw new Error('A valid date and time is required.');
  }
  return {
    category: input.category,
    trigger: isCravingTrigger(input.trigger) ? input.trigger : null,
    occurred_at: occurredAt,
    intensity: cleanIntensity(input.intensity),
    outcome: isOutcome(input.outcome) ? input.outcome : null,
    notes: cleanText(typeof input.notes === 'string' ? input.notes : null, 1000),
  };
}

export async function insertCravingEntryDb(
  db: CravingDb,
  patientId: string,
  input: NewCravingEntry,
): Promise<string> {
  const entryId = randomId();
  await db.runAsync(
    `INSERT INTO craving_entries
       (entry_id, patient_id, category, trigger, occurred_at,
        intensity, outcome, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    patientId,
    input.category,
    input.trigger ?? null,
    input.occurred_at,
    input.intensity ?? null,
    input.outcome ?? null,
    input.notes ?? null,
  );
  return entryId;
}

export async function updateCravingEntryDb(
  db: CravingDb,
  patientId: string,
  entryId: string,
  input: NewCravingEntry,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE craving_entries
     SET category = ?, trigger = ?, occurred_at = ?,
         intensity = ?, outcome = ?, notes = ?
     WHERE entry_id = ? AND patient_id = ?`,
    input.category,
    input.trigger ?? null,
    input.occurred_at,
    input.intensity ?? null,
    input.outcome ?? null,
    input.notes ?? null,
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function deleteCravingEntryDb(
  db: CravingDb,
  patientId: string,
  entryId: string,
): Promise<boolean> {
  const r = await db.runAsync(
    'DELETE FROM craving_entries WHERE entry_id = ? AND patient_id = ?',
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function listCravingEntriesDb(
  db: CravingDb,
  patientId: string,
  limit = 100,
): Promise<CravingEntry[]> {
  return db.getAllAsync<CravingEntry>(
    'SELECT * FROM craving_entries WHERE patient_id = ? ORDER BY occurred_at DESC LIMIT ?',
    patientId,
    Math.max(1, Math.min(500, Math.floor(limit))),
  );
}

export interface CravingWeekSummary {
  total: number;
  passed: number;
  used: number;
  byTrigger: Partial<Record<CravingTrigger, number>>;
  topTrigger: CravingTrigger | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Trailing-7-day summary ending todayKey, from real rows only. Malformed
 * rows are skipped; an empty window yields zeros and a null top trigger.
 */
export function summarizeCravingWeek(
  entries: ReadonlyArray<{ occurred_at: unknown; trigger: unknown; outcome: unknown }>,
  todayKey: string,
): CravingWeekSummary {
  const out: CravingWeekSummary = {
    total: 0,
    passed: 0,
    used: 0,
    byTrigger: {},
    topTrigger: null,
  };
  if (!DAY_RE.test(todayKey.slice(0, 10))) return out;
  const end = todayKey.slice(0, 10);
  const startD = new Date(`${end}T12:00:00`);
  if (Number.isNaN(startD.getTime())) return out;
  startD.setDate(startD.getDate() - 6);
  const start = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-${String(startD.getDate()).padStart(2, '0')}`;
  for (const e of entries) {
    const day = typeof e.occurred_at === 'string' ? e.occurred_at.slice(0, 10) : '';
    if (!DAY_RE.test(day) || day < start || day > end) continue;
    out.total += 1;
    if (e.outcome === 'passed') out.passed += 1;
    else if (e.outcome === 'used') out.used += 1;
    if (isCravingTrigger(e.trigger)) {
      out.byTrigger[e.trigger] = (out.byTrigger[e.trigger] ?? 0) + 1;
    }
  }
  let best: CravingTrigger | null = null;
  let bestCount = 0;
  for (const t of CRAVING_TRIGGERS) {
    const n = out.byTrigger[t] ?? 0;
    if (n > bestCount) {
      best = t;
      bestCount = n;
    }
  }
  out.topTrigger = best;
  return out;
}

/** One descriptive status line — counts with their window, never judgment. */
export function cravingStatusLine(summary: CravingWeekSummary): string {
  if (summary.total === 0) return 'No cravings logged in the last 7 days';
  const entryWord = summary.total === 1 ? 'craving' : 'cravings';
  return `${summary.total} ${entryWord} logged in the last 7 days · ${summary.passed} passed`;
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<CravingDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as CravingDb;
}

export async function insertCravingEntry(
  patientId: string,
  input: NewCravingEntry,
): Promise<string> {
  return insertCravingEntryDb(await getDb(), patientId, input);
}

export async function updateCravingEntry(
  patientId: string,
  entryId: string,
  input: NewCravingEntry,
): Promise<boolean> {
  return updateCravingEntryDb(await getDb(), patientId, entryId, input);
}

export async function deleteCravingEntry(
  patientId: string,
  entryId: string,
): Promise<boolean> {
  return deleteCravingEntryDb(await getDb(), patientId, entryId);
}

export async function listCravingEntries(
  patientId: string,
  limit = 100,
): Promise<CravingEntry[]> {
  return listCravingEntriesDb(await getDb(), patientId, limit);
}
