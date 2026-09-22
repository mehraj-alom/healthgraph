/**
 * substances.ts — neutral substance-use tracking (device-only, local-first).
 *
 * Tracking, NOT treatment: no withdrawal/medical guidance, no diagnoses, no
 * conversion formulas. Amounts are user-entered value+unit pairs stored
 * verbatim. Device-only by design (no sync_status, no queue rows) — the UI
 * labels this data accordingly instead of implying server backup.
 *
 * Node-testable by design: logic takes an explicit database handle and this
 * module has zero runtime imports (production entry points resolve the
 * encrypted database lazily).
 */

export const SUBSTANCE_CATEGORIES = ['alcohol', 'tobacco', 'other'] as const;

export type SubstanceCategory = (typeof SUBSTANCE_CATEGORIES)[number];

export interface SubstanceEntry {
  entry_id: string;
  patient_id: string;
  category: SubstanceCategory;
  /** User label for 'other', or occasion text (e.g. "dinner with friends"). */
  label: string | null;
  /** ISO datetime of the entry. */
  occurred_at: string;
  amount_value: number | null;
  amount_unit: string | null;
  notes: string | null;
  created_at: string;
}

export interface SubstanceDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

export function isSubstanceCategory(value: unknown): value is SubstanceCategory {
  return (
    typeof value === 'string' &&
    (SUBSTANCE_CATEGORIES as readonly string[]).includes(value)
  );
}

export interface NewSubstanceEntry {
  category: SubstanceCategory;
  label?: string | null;
  occurred_at: string;
  amount_value?: number | null;
  amount_unit?: string | null;
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

function cleanAmount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Validate + normalize a new entry (throws on invalid input, never stores). */
export function normalizeSubstanceInput(input: {
  category: unknown;
  label?: unknown;
  occurred_at: unknown;
  amount_value?: unknown;
  amount_unit?: unknown;
  notes?: unknown;
}): NewSubstanceEntry {
  if (!isSubstanceCategory(input.category)) {
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
  const amountValue =
    typeof input.amount_value === 'number' ? cleanAmount(input.amount_value) : null;
  return {
    category: input.category,
    label: cleanText(typeof input.label === 'string' ? input.label : null, 120),
    occurred_at: occurredAt,
    amount_value: amountValue,
    amount_unit:
      amountValue === null
        ? null
        : cleanText(typeof input.amount_unit === 'string' ? input.amount_unit : null, 24),
    notes: cleanText(typeof input.notes === 'string' ? input.notes : null, 1000),
  };
}

export async function insertSubstanceEntryDb(
  db: SubstanceDb,
  patientId: string,
  input: NewSubstanceEntry,
): Promise<string> {
  const entryId = randomId();
  await db.runAsync(
    `INSERT INTO substance_entries
       (entry_id, patient_id, category, label, occurred_at,
        amount_value, amount_unit, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    patientId,
    input.category,
    input.label,
    input.occurred_at,
    input.amount_value,
    input.amount_unit,
    input.notes,
  );
  return entryId;
}

export async function updateSubstanceEntryDb(
  db: SubstanceDb,
  patientId: string,
  entryId: string,
  input: NewSubstanceEntry,
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE substance_entries
     SET category = ?, label = ?, occurred_at = ?,
         amount_value = ?, amount_unit = ?, notes = ?
     WHERE entry_id = ? AND patient_id = ?`,
    input.category,
    input.label,
    input.occurred_at,
    input.amount_value,
    input.amount_unit,
    input.notes,
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function deleteSubstanceEntryDb(
  db: SubstanceDb,
  patientId: string,
  entryId: string,
): Promise<boolean> {
  const r = await db.runAsync(
    'DELETE FROM substance_entries WHERE entry_id = ? AND patient_id = ?',
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function listSubstanceEntriesDb(
  db: SubstanceDb,
  patientId: string,
  limit = 100,
): Promise<SubstanceEntry[]> {
  return db.getAllAsync<SubstanceEntry>(
    'SELECT * FROM substance_entries WHERE patient_id = ? ORDER BY occurred_at DESC LIMIT ?',
    patientId,
    Math.max(1, Math.min(500, Math.floor(limit))),
  );
}

export interface SubstanceDayPoint {
  date: string;
  count: number;
}

/**
 * Per-day entry counts for the trailing `days` ending todayKey, ascending.
 * Counts real rows only — a quiet day is zero, never interpolated.
 */
export function summarizeSubstanceWeeks(
  entries: ReadonlyArray<Pick<SubstanceEntry, 'occurred_at'>>,
  todayKey: string,
  days = 7,
): SubstanceDayPoint[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const day = String(e.occurred_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: SubstanceDayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(`${todayKey}T12:00:00`);
    if (Number.isNaN(d.getTime())) break;
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const date = `${y}-${m}-${day}`;
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<SubstanceDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as SubstanceDb;
}

export async function insertSubstanceEntry(
  patientId: string,
  input: NewSubstanceEntry,
): Promise<string> {
  return insertSubstanceEntryDb(await getDb(), patientId, input);
}

export async function updateSubstanceEntry(
  patientId: string,
  entryId: string,
  input: NewSubstanceEntry,
): Promise<boolean> {
  return updateSubstanceEntryDb(await getDb(), patientId, entryId, input);
}

export async function deleteSubstanceEntry(
  patientId: string,
  entryId: string,
): Promise<boolean> {
  return deleteSubstanceEntryDb(await getDb(), patientId, entryId);
}

export async function listSubstanceEntries(
  patientId: string,
  limit = 100,
): Promise<SubstanceEntry[]> {
  return listSubstanceEntriesDb(await getDb(), patientId, limit);
}
