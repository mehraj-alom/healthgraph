/**
 * cycle.ts — explicit cycle tracking (device-only, local-first).
 *
 * User-entered start/end/notes only. NOTHING is inferred: no fertility,
 * ovulation, pregnancy, or condition predictions — and no prediction model
 * exists in this batch by design. History groups consecutive starts into
 * plain cycles for display; a cycle is "start → next start", never a
 * medical statement.
 *
 * Device-only (no sync_status, no queue rows); the UI labels this data
 * accordingly. Node-testable by design (explicit handle, zero imports).
 */

export const CYCLE_KINDS = ['period-start', 'period-end', 'note'] as const;

export type CycleKind = (typeof CYCLE_KINDS)[number];

export interface CycleEntry {
  entry_id: string;
  patient_id: string;
  kind: CycleKind;
  /** YYYY-MM-DD calendar day. */
  date: string;
  notes: string | null;
  created_at: string;
}

export interface CycleDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

export function isCycleKind(value: unknown): value is CycleKind {
  return (
    typeof value === 'string' && (CYCLE_KINDS as readonly string[]).includes(value)
  );
}

export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewCycleEntry {
  kind: CycleKind;
  date: string;
  notes?: string | null;
}

/** Validate + normalize a new entry (throws on invalid input, never stores). */
export function normalizeCycleInput(input: {
  kind: unknown;
  date: unknown;
  notes?: unknown;
}): NewCycleEntry {
  if (!isCycleKind(input.kind)) {
    throw new Error('Choose a cycle start, end, or note.');
  }
  if (!isCalendarDay(input.date)) {
    throw new Error('A valid calendar date is required.');
  }
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 1000) : '';
  return { kind: input.kind, date: input.date, notes: notes || null };
}

export async function insertCycleEntryDb(
  db: CycleDb,
  patientId: string,
  input: NewCycleEntry,
): Promise<string> {
  const entryId = randomId();
  await db.runAsync(
    'INSERT INTO cycle_entries (entry_id, patient_id, kind, date, notes) VALUES (?, ?, ?, ?, ?)',
    entryId,
    patientId,
    input.kind,
    input.date,
    input.notes,
  );
  return entryId;
}

export async function updateCycleEntryDb(
  db: CycleDb,
  patientId: string,
  entryId: string,
  input: NewCycleEntry,
): Promise<boolean> {
  const r = await db.runAsync(
    'UPDATE cycle_entries SET kind = ?, date = ?, notes = ? WHERE entry_id = ? AND patient_id = ?',
    input.kind,
    input.date,
    input.notes,
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function deleteCycleEntryDb(
  db: CycleDb,
  patientId: string,
  entryId: string,
): Promise<boolean> {
  const r = await db.runAsync(
    'DELETE FROM cycle_entries WHERE entry_id = ? AND patient_id = ?',
    entryId,
    patientId,
  );
  return Number(r.changes ?? 0) > 0;
}

export async function listCycleEntriesDb(
  db: CycleDb,
  patientId: string,
  limit = 200,
): Promise<CycleEntry[]> {
  return db.getAllAsync<CycleEntry>(
    'SELECT * FROM cycle_entries WHERE patient_id = ? ORDER BY date DESC, created_at DESC LIMIT ?',
    patientId,
    Math.max(1, Math.min(500, Math.floor(limit))),
  );
}

export interface CycleSpan {
  /** Opening period-start day, or null for notes before any recorded start. */
  start: string | null;
  /** Closing start day (exclusive), or null when ongoing/unknown. */
  endExclusive: string | null;
  entries: CycleEntry[];
}

/**
 * Group entries into plain display spans: each 'period-start' opens a span
 * closed by the next start; notes attach to their span (or a dateless
 * leading group). Lengths are day counts between recorded starts — shown
 * as history, never as predictions.
 */
export function groupCycleSpans(entries: readonly CycleEntry[]): CycleSpan[] {
  const sorted = [...entries].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  const spans: CycleSpan[] = [];
  let current: CycleEntry[] = [];
  let currentStart: string | null = null;
  const flush = (endExclusive: string | null) => {
    if (current.length > 0 || currentStart !== null) {
      spans.push({ start: currentStart, endExclusive, entries: current });
    }
    current = [];
    currentStart = null;
  };
  for (const entry of sorted) {
    if (entry.kind === 'period-start') {
      flush(entry.date);
      currentStart = entry.date;
      current = [entry];
    } else {
      if (currentStart === null && current.length === 0 && spans.length === 0) {
        current = [entry];
      } else {
        current.push(entry);
      }
    }
  }
  flush(null);
  return spans.reverse();
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<CycleDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as CycleDb;
}

export async function insertCycleEntry(
  patientId: string,
  input: NewCycleEntry,
): Promise<string> {
  return insertCycleEntryDb(await getDb(), patientId, input);
}

export async function updateCycleEntry(
  patientId: string,
  entryId: string,
  input: NewCycleEntry,
): Promise<boolean> {
  return updateCycleEntryDb(await getDb(), patientId, entryId, input);
}

export async function deleteCycleEntry(
  patientId: string,
  entryId: string,
): Promise<boolean> {
  return deleteCycleEntryDb(await getDb(), patientId, entryId);
}

export async function listCycleEntries(
  patientId: string,
  limit = 200,
): Promise<CycleEntry[]> {
  return listCycleEntriesDb(await getDb(), patientId, limit);
}
