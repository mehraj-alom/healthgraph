/**
 * medicationTakenEvents.ts — Local SQLite repository for MedicationTakenEvent entities.
 *
 * All queries are scoped to the authenticated patient via patient_id.
 * Provides local-first dose tracking with sync queue integration.
 */

import { getDatabase, withSerializedTransaction } from '@/db/connection';
import type { MedicationTakenEvent, DoseTakenStatus, ActiveMedicationForDailyLog, DailyMedicationSchedule } from '@/types';
import { groupTakenByMinute, matchTakenToSlot } from '@/utils/medicationSchedule';

// ─── Row → Event Mapping ─────────────────────────────────────────────────────

interface TakenEventRow {
  event_id: string;
  medication_id: string;
  patient_id: string;
  taken_at: string;
  scheduled_for: string | null;
  dose_taken: number | null;
  dose_unit: string | null;
  status: string;
  notes: string | null;
  clinical_event_id: string | null;
  created_at: string;
  updated_at: string;
  local_id: string | null;
  sync_status: string;
  server_revision: number | null;
}

function rowToEvent(row: TakenEventRow): MedicationTakenEvent {
  return {
    event_id: row.event_id,
    medication_id: row.medication_id,
    patient_id: row.patient_id,
    taken_at: row.taken_at,
    scheduled_for: row.scheduled_for,
    dose_taken: row.dose_taken,
    dose_unit: row.dose_unit,
    status: row.status as DoseTakenStatus,
    notes: row.notes,
    clinical_event_id: row.clinical_event_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Hydration Metadata ──────────────────────────────────────────────────────

/**
 * Key for storing taken-events hydration state.
 * Format: `taken_hydrated:{patient_id}`
 * Value: ISO timestamp of last successful hydration
 */

function getHydrationKey(patientId: string): string {
  return `taken_hydrated:${patientId}`;
}

/**
 * Check if taken events have been hydrated for this patient.
 * Returns true if hydration has occurred (even if no events exist on server).
 *
 * Reads the dedicated hydration_state table (migration 6). A single-row
 * lookup by primary key; no mutation-queue involvement.
 */
export async function areTakenEventsHydrated(patientId: string): Promise<boolean> {
  const db = await getDatabase();
  const key = getHydrationKey(patientId);
  const result = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM hydration_state WHERE scope = ? AND key = ?',
    ['taken-events', key],
  );
  return result !== null;
}

/**
 * Mark taken events as hydrated for this patient.
 * Called after successful server fetch (even if server returns empty array).
 *
 * Single-statement idempotent upsert into hydration_state (migration 6):
 * atomic, replay-safe, and never enqueued for network sync.
 */
export async function markTakenEventsHydrated(patientId: string): Promise<void> {
  const db = await getDatabase();
  const key = getHydrationKey(patientId);
  const now = nowIso();

  await db.runAsync(
    `INSERT INTO hydration_state (scope, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(scope, key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now')`,
    ['taken-events', key, JSON.stringify({ hydrated_at: now })],
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateLocalId(): string {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Get the user's local date as YYYY-MM-DD string.
 */
function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the weekday (0=Sunday, 6=Saturday) for a local date string YYYY-MM-DD.
 */
function getWeekday(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getDay();
}

/**
 * Convert an ISO datetime string to a local YYYY-MM-DD date string.
 * This ensures SQLite DATE() comparisons use the user's local calendar day.
 */
function toLocalDateString(isoString: string): string {
  const date = new Date(isoString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Frequency → Default Times Mapping (matches backend) ─────────────────────
// Exported for the reminder scheduler, which applies the same slot rules to
// future occurrences without duplicating the mapping.

export function getDefaultScheduledTimes(frequency: string): string[] {
  switch (frequency) {
    case 'ONCE_DAILY': return ['08:00'];
    case 'TWICE_DAILY': return ['08:00', '20:00'];
    case 'THREE_TIMES_DAILY': return ['08:00', '14:00', '20:00'];
    case 'FOUR_TIMES_DAILY': return ['08:00', '12:00', '16:00', '20:00'];
    case 'EVERY_MORNING': return ['08:00'];
    case 'EVERY_EVENING': return ['20:00'];
    case 'EVERY_NIGHT': return ['22:00'];
    case 'EVERY_8_HOURS': return ['08:00', '16:00', '00:00'];
    case 'EVERY_12_HOURS': return ['08:00', '20:00'];
    case 'AS_NEEDED': return [];
    default: return ['08:00'];
  }
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Get all taken events for a patient, ordered by taken_at descending.
 */
export async function getMedicationTakenEvents(
  patientId: string,
  limit: number = 50,
): Promise<MedicationTakenEvent[]> {
  const db = await getDatabase();
  const result = await db.getAllAsync<TakenEventRow>(
    'SELECT * FROM medication_taken_events WHERE patient_id = ? ORDER BY taken_at DESC LIMIT ?',
    [patientId, limit],
  );
  return result.map(rowToEvent);
}

/**
 * Get a single taken event by ID, scoped to patient.
 */
export async function getMedicationTakenEventById(
  patientId: string,
  eventId: string,
): Promise<MedicationTakenEvent | null> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<TakenEventRow>(
    'SELECT * FROM medication_taken_events WHERE patient_id = ? AND event_id = ?',
    [patientId, eventId],
  );
  return result ? rowToEvent(result) : null;
}

/**
 * UTC bounds of a local calendar day (YYYY-MM-DD).
 *
 * taken_at is stored as an ISO-8601 UTC string, so lexical comparison is
 * chronological. `taken_at >= start AND taken_at < end` matches exactly the
 * rows `strftime('%Y-%m-%d', taken_at, 'localtime') = date` would match, but
 * as a sargable range over the (patient_id, taken_at) /
 * (medication_id, taken_at) indexes instead of a per-row function call.
 * Returns null for malformed input (matches nothing, never throws).
 */
export function localDayUtcBounds(date: string): [string, string] | null {
  const parts = date.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return [start.toISOString(), end.toISOString()];
}

/**
 * Get taken events for a specific date (YYYY-MM-DD), scoped to patient.
 * Matches the user's local calendar day via an index-friendly UTC range.
 */
export async function getMedicationTakenEventsForDate(
  patientId: string,
  date: string,
): Promise<MedicationTakenEvent[]> {
  const bounds = localDayUtcBounds(date);
  if (!bounds) return [];
  const db = await getDatabase();
  const result = await db.getAllAsync<TakenEventRow>(
    `SELECT * FROM medication_taken_events
     WHERE patient_id = ?
       AND taken_at >= ? AND taken_at < ?
     ORDER BY taken_at DESC`,
    [patientId, bounds[0], bounds[1]],
  );
  return result.map(rowToEvent);
}

/**
 * Get taken events inside an instant range, scoped to patient.
 *
 * Single bounded read for windowed metrics (the Discipline Engine reads a
 * trailing-14-day window here instead of one query per day). taken_at is a
 * UTC ISO-8601 string so lexical comparison is chronological; callers map
 * instants to local calendar days themselves. Ordered ascending.
 */
export async function getTakenEventsInRange(
  patientId: string,
  startIso: string,
  endIso: string,
): Promise<MedicationTakenEvent[]> {
  const db = await getDatabase();
  const result = await db.getAllAsync<TakenEventRow>(
    `SELECT * FROM medication_taken_events
     WHERE patient_id = ?
       AND taken_at >= ? AND taken_at < ?
     ORDER BY taken_at ASC`,
    [patientId, startIso, endIso],
  );
  return result.map(rowToEvent);
}

/**
 * Get taken events for a specific medication on a specific date.
 */
export async function getTakenEventsForMedicationOnDate(
  patientId: string,
  medicationId: string,
  date: string,
): Promise<MedicationTakenEvent[]> {
  const bounds = localDayUtcBounds(date);
  if (!bounds) return [];
  const db = await getDatabase();
  const result = await db.getAllAsync<TakenEventRow>(
    `SELECT * FROM medication_taken_events
     WHERE patient_id = ?
       AND medication_id = ?
       AND taken_at >= ? AND taken_at < ?
     ORDER BY taken_at ASC`,
    [patientId, medicationId, bounds[0], bounds[1]],
  );
  return result.map(rowToEvent);
}

/**
 * Pending (never-synced) taken events older than a cutoff, oldest first.
 *
 * Feeds the offline retry flusher: rows the engine can never upload itself
 * (taken_events have no generic sync path — the engine marks their queue
 * rows completed without posting). Patient-scoped; the cutoff keeps rows
 * whose originating direct POST may still be in flight out of the retry set.
 */
export async function getPendingTakenEvents(
  patientId: string,
  olderThanIso: string,
): Promise<MedicationTakenEvent[]> {
  const db = await getDatabase();
  const result = await db.getAllAsync<TakenEventRow>(
    `SELECT * FROM medication_taken_events
     WHERE patient_id = ?
       AND sync_status = 'pending_create'
       AND taken_at < ?
     ORDER BY taken_at ASC`,
    [patientId, olderThanIso],
  );
  return result.map(rowToEvent);
}

// ─── Write Operations ────────────────────────────────────────────────────────

/**
 * Insert a new taken event into local SQLite.
 * Sets sync_status = 'pending_create'.
 * Returns the event_id for immediate use.
 */
export async function insertMedicationTakenEvent(
  patientId: string,
  event: Omit<MedicationTakenEvent, 'event_id' | 'patient_id' | 'created_at' | 'updated_at'>,
): Promise<string> {
  const db = await getDatabase();
  const localId = generateLocalId();
  const now = nowIso();

  // Atomic: row + queue entry commit together (see medications.ts).
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO medication_taken_events (
      event_id, medication_id, patient_id, taken_at, scheduled_for,
      dose_taken, dose_unit, status, notes, clinical_event_id,
      created_at, updated_at, local_id, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
      [
        localId,
        event.medication_id,
        patientId,
        event.taken_at,
        event.scheduled_for,
        event.dose_taken,
        event.dose_unit,
        event.status,
        event.notes,
        event.clinical_event_id,
        now,
        now,
        localId,
      ],
    );

    // Add to sync queue (same transaction as the row write)
    await writeQueueRow(db, patientId, 'medication_taken_events', localId, 'create', {
      ...event,
      event_id: localId,
      patient_id: patientId,
      created_at: now,
      updated_at: now,
    });
  });
  announceQueueWrite();

  return localId;
}

/**
 * Update an existing taken event.
 * Sets sync_status = 'pending_update'.
 */
export async function updateMedicationTakenEvent(
  patientId: string,
  eventId: string,
  updates: Partial<Omit<MedicationTakenEvent, 'event_id' | 'patient_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.medication_id !== undefined) { setClauses.push('medication_id = ?'); params.push(updates.medication_id); }
  if (updates.taken_at !== undefined) { setClauses.push('taken_at = ?'); params.push(updates.taken_at); }
  if (updates.scheduled_for !== undefined) { setClauses.push('scheduled_for = ?'); params.push(updates.scheduled_for); }
  if (updates.dose_taken !== undefined) { setClauses.push('dose_taken = ?'); params.push(updates.dose_taken); }
  if (updates.dose_unit !== undefined) { setClauses.push('dose_unit = ?'); params.push(updates.dose_unit); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.notes !== undefined) { setClauses.push('notes = ?'); params.push(updates.notes); }
  if (updates.clinical_event_id !== undefined) { setClauses.push('clinical_event_id = ?'); params.push(updates.clinical_event_id); }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  params.push(now);
  setClauses.push("sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END");

  params.push(patientId, eventId);

  let queued = false;
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `UPDATE medication_taken_events SET ${setClauses.join(', ')} WHERE patient_id = ? AND event_id = ?`,
      params,
    );

    const current = await getMedicationTakenEventById(patientId, eventId);
    if (current) {
      await writeQueueRow(db, patientId, 'medication_taken_events', eventId, 'update', {
        ...current,
        ...updates,
        event_id: eventId,
        patient_id: patientId,
        updated_at: now,
      });
      queued = true;
    }
  });
  if (queued) announceQueueWrite();
}

/**
 * Delete a taken event.
 * For synced events, sets sync_status = 'pending_delete'.
 * For pending_create events, removes entirely.
 */
export async function deleteMedicationTakenEvent(
  patientId: string,
  eventId: string,
): Promise<void> {
  const db = await getDatabase();

  const existing = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM medication_taken_events WHERE patient_id = ? AND event_id = ?',
    [patientId, eventId],
  );

  if (!existing) return;

  if (existing.sync_status === 'pending_create') {
    // Never synced — safe to remove
    await db.runAsync(
      'DELETE FROM medication_taken_events WHERE patient_id = ? AND event_id = ?',
      [patientId, eventId],
    );
  } else {
    // Synced — soft delete (row + queue entry commit together)
    await withSerializedTransaction(db, async () => {
      await db.runAsync(
        `UPDATE medication_taken_events
         SET updated_at = ?, sync_status = 'pending_delete'
         WHERE patient_id = ? AND event_id = ?`,
        [nowIso(), patientId, eventId],
      );
      await writeQueueRow(db, patientId, 'medication_taken_events', eventId, 'delete', null);
    });
    announceQueueWrite();
  }
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Reconcile a locally-created event with the server response.
 *
 * After the API POST succeeds, the server creates its own event_id.
 * This function:
 * 1. Finds the local pending_create event by local_id
 * 2. Updates it with the server's event_id
 * 3. Marks it as synced
 * 4. Removes the sync_queue entry
 *
 * Idempotent: Can be called multiple times with the same IDs safely.
 * If the local event has already been reconciled (sync_status != 'pending_create'),
 * it returns the server event_id without changes.
 *
 * Returns the server event_id on success, null if local event not found.
 */
export async function reconcileTakenEvent(
  patientId: string,
  localEventId: string,
  serverEventId: string,
): Promise<string | null> {
  const db = await getDatabase();

  // Find the local event
  const localEvent = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM medication_taken_events WHERE event_id = ? AND patient_id = ?',
    [localEventId, patientId],
  );

  if (!localEvent) {
    // Local event doesn't exist — might have been deleted or already reconciled
    // Check if server event exists
    const serverExists = await db.getFirstAsync<{ event_id: string }>(
      'SELECT event_id FROM medication_taken_events WHERE event_id = ?',
      [serverEventId],
    );
    return serverExists ? serverEventId : null;
  }

  if (localEvent.sync_status === 'synced') {
    // Already reconciled — idempotent return
    return serverEventId;
  }

  if (localEvent.sync_status !== 'pending_create') {
    // Has pending update/delete — cannot reconcile, sync engine will handle
    return null;
  }

  // Update: replace local event_id with server event_id, mark synced
  await db.runAsync(
    `UPDATE medication_taken_events
     SET event_id = ?, local_id = NULL, sync_status = 'synced', updated_at = ?
     WHERE event_id = ? AND patient_id = ?`,
    [serverEventId, nowIso(), localEventId, patientId],
  );

  // Remove sync_queue entry
  await db.runAsync(
    "DELETE FROM sync_queue WHERE table_name = 'medication_taken_events' AND record_id = ?",
    [localEventId],
  );

  return serverEventId;
}

/**
 * Check if a server event already exists locally (to prevent duplicates during hydration).
 */
export async function serverEventExists(
  serverEventId: string,
): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ event_id: string }>(
    'SELECT event_id FROM medication_taken_events WHERE event_id = ?',
    [serverEventId],
  );
  return result !== null;
}

/**
 * Find a local pending_create event that matches the server event's attributes.
 * Used for recovery when reconciliation fails but API succeeded.
 * Returns the local event_id if found, null otherwise.
 */
export async function findMatchingLocalEvent(
  patientId: string,
  medicationId: string,
  takenAt: string,
): Promise<string | null> {
  // Minute-precision match as a half-open UTC range: identical rows to
  // `strftime('%Y-%m-%dT%H:%M', taken_at) = strftime('%Y-%m-%dT%H:%M', ?)`
  // for ISO-8601 values, without per-row function evaluation.
  const at = new Date(takenAt).getTime();
  if (Number.isNaN(at)) return null;
  const start = new Date(Math.floor(at / 60000) * 60000).toISOString();
  const end = new Date(Math.floor(at / 60000) * 60000 + 60000).toISOString();
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ event_id: string }>(
    `SELECT event_id FROM medication_taken_events
     WHERE patient_id = ?
       AND medication_id = ?
       AND sync_status = 'pending_create'
       AND taken_at >= ? AND taken_at < ?
     LIMIT 1`,
    [patientId, medicationId, start, end],
  );
  return result?.event_id ?? null;
}

// ─── Hydration ───────────────────────────────────────────────────────────────

/**
 * Upsert server taken events into SQLite.
 * Preserves locally pending mutations — never overwrites.
 * Detects and reconciles duplicates from failed reconciliation attempts.
 */
export async function hydrateTakenEvents(
  patientId: string,
  serverEvents: MedicationTakenEvent[],
): Promise<void> {
  const db = await getDatabase();

  // One transaction for the whole batch: atomic and far fewer round-trips
  // than per-event commits. Per-row logic is unchanged.
  await withSerializedTransaction(db, async () => {
  for (const event of serverEvents) {
    // Check if this event_id exists locally (could be from reconciliation)
    const existing = await db.getFirstAsync<{ sync_status: string }>(
      'SELECT sync_status FROM medication_taken_events WHERE event_id = ?',
      [event.event_id],
    );

    if (existing) {
      // Already exists — if synced, update; if pending, skip
      if (existing.sync_status !== 'synced') {
        continue;
      }
      // Update existing synced record
      await db.runAsync(
        `UPDATE medication_taken_events SET
          medication_id = ?, patient_id = ?, taken_at = ?, scheduled_for = ?,
          dose_taken = ?, dose_unit = ?, status = ?, notes = ?,
          clinical_event_id = ?, created_at = ?, updated_at = ?, sync_status = 'synced'
         WHERE event_id = ? AND sync_status = 'synced'`,
        [
          event.medication_id, patientId, event.taken_at, event.scheduled_for,
          event.dose_taken, event.dose_unit, event.status, event.notes,
          event.clinical_event_id, event.created_at, event.updated_at,
          event.event_id,
        ],
      );
    } else {
      // Check for a matching local pending event (from failed reconciliation).
      // Same minute-precision match as findMatchingLocalEvent, inlined so the
      // whole hydration loop runs inside a single transaction.
      const matchAt = new Date(event.taken_at).getTime();
      let localMatch: { event_id: string } | null = null;
      if (!Number.isNaN(matchAt)) {
        const matchStart = new Date(Math.floor(matchAt / 60000) * 60000).toISOString();
        const matchEnd = new Date(Math.floor(matchAt / 60000) * 60000 + 60000).toISOString();
        localMatch = await db.getFirstAsync<{ event_id: string }>(
          `SELECT event_id FROM medication_taken_events
           WHERE patient_id = ?
             AND medication_id = ?
             AND sync_status = 'pending_create'
             AND taken_at >= ? AND taken_at < ?
           LIMIT 1`,
          [patientId, event.medication_id, matchStart, matchEnd],
        );
      }

      if (localMatch) {
        // Found matching local event — reconcile it
        await reconcileTakenEvent(patientId, localMatch.event_id, event.event_id);
      } else {
        // New event — insert
        await db.runAsync(
          `INSERT INTO medication_taken_events (
            event_id, medication_id, patient_id, taken_at, scheduled_for,
            dose_taken, dose_unit, status, notes, clinical_event_id,
            created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
          [
            event.event_id, event.medication_id, patientId, event.taken_at,
            event.scheduled_for, event.dose_taken, event.dose_unit, event.status,
            event.notes, event.clinical_event_id, event.created_at, event.updated_at,
          ],
        );
      }
    }
  }
  });
}

// ─── Local Schedule Computation ──────────────────────────────────────────────

/**
 * Compute the daily medication schedule locally.
 * Reproduces the backend logic from GET /api/v1/medications/schedule/{date}.
 *
 * What is computed locally:
 * - Active medications filtered by date range + weekday
 * - scheduled_times inferred from frequency when not set
 * - Taken status matched by HH:MM of taken_at
 *
 * What remains server-backed:
 * - ClinicalEvent creation (happens on POST /taken)
 * - Graph sync enqueuing
 * - Outbox processing
 *
 * This function does NOT handle:
 * - Medications not yet in local SQLite
 * - Taken events not yet in local SQLite
 */
export async function computeLocalSchedule(
  patientId: string,
  targetDate: string,
): Promise<DailyMedicationSchedule[]> {
  const db = await getDatabase();
  const weekday = getWeekday(targetDate);

  // 1. Get active medications
  const medications = await db.getAllAsync<{
    medication_id: string;
    name: string;
    strength: string | null;
    strength_unit: string | null;
    dose_amount: number | null;
    dose_unit: string | null;
    frequency: string;
    scheduled_times: string | null;
    scheduled_weekdays: string | null;
    route: string | null;
    prn: number;
    start_date: string | null;
    end_date: string | null;
  }>(
    "SELECT * FROM medications WHERE patient_id = ? AND status = 'ACTIVE' ORDER BY name ASC",
    [patientId],
  );

  const schedule: DailyMedicationSchedule[] = [];

  // One range lookup for the whole local day (index-friendly); the per-med
  // loop below filters the in-memory rows instead of issuing N queries.
  const dayBounds = localDayUtcBounds(targetDate);
  const dayRows = dayBounds
    ? await db.getAllAsync<{ medication_id: string; scheduled_for: string | null; taken_at: string; event_id: string }>(
        `SELECT medication_id, scheduled_for, taken_at, event_id FROM medication_taken_events
         WHERE patient_id = ?
           AND taken_at >= ? AND taken_at < ?`,
        [patientId, dayBounds[0], dayBounds[1]],
      )
    : [];
  const rowsByMed = new Map<string, typeof dayRows>();
  for (const row of dayRows) {
    const list = rowsByMed.get(row.medication_id);
    if (list) list.push(row);
    else rowsByMed.set(row.medication_id, [row]);
  }

  for (const med of medications) {
    // Skip if outside date range
    if (med.start_date && med.start_date > targetDate) continue;
    if (med.end_date && med.end_date < targetDate) continue;

    // Skip if weekday not in scheduled_weekdays
    if (med.scheduled_weekdays) {
      try {
        const weekdays: number[] = JSON.parse(med.scheduled_weekdays);
        if (!weekdays.includes(weekday)) continue;
      } catch {
        // Malformed JSON — skip this medication
        continue;
      }
    }

    // Skip PRN medications (no fixed schedule)
    if (med.prn) continue;

    // Determine scheduled times
    let scheduledTimes: string[];
    if (med.scheduled_times) {
      try {
        scheduledTimes = JSON.parse(med.scheduled_times);
        if (!Array.isArray(scheduledTimes) || scheduledTimes.length === 0) continue;
      } catch {
        scheduledTimes = getDefaultScheduledTimes(med.frequency);
      }
    } else {
      scheduledTimes = getDefaultScheduledTimes(med.frequency);
    }

    // Taken events for this medication on this date (local timezone),
    // sliced from the single day-range lookup above.
    const takenEvents = (rowsByMed.get(med.medication_id) ?? [])
      .slice()
      .sort((a, b) => (a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0));

    // Grouped by clock minute. Two legitimate events can share one minute
    // (unscheduled + scheduled dose, correction re-tap): the map keeps both
    // and the slot below prefers the one scheduled for it, so neither dose
    // silently disappears from the schedule.
    const takenByMinute = groupTakenByMinute(takenEvents);

    // Build schedule items
    for (const time of scheduledTimes) {
      const takenEvent = matchTakenToSlot(takenByMinute.get(time) ?? [], time);
      schedule.push({
        medication: {
          medication_id: med.medication_id,
          name: med.name,
          strength: med.strength,
          strength_unit: med.strength_unit,
          dose_amount: med.dose_amount,
          dose_unit: med.dose_unit,
          frequency: med.frequency as ActiveMedicationForDailyLog['frequency'],
          scheduled_times: scheduledTimes,
          route: med.route as ActiveMedicationForDailyLog['route'],
          prn: med.prn === 1,
        },
        scheduled_time: time,
        taken: !!takenEvent,
        taken_event_id: takenEvent?.event_id ?? null,
        taken_at: takenEvent?.taken_at ?? null,
      });
    }
  }

  // Sort by scheduled_time
  schedule.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  return schedule;
}

// ─── Sync Queue ──────────────────────────────────────────────────────────────

type SyncDb = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Queue-row SQL only (no side effects): safe to call INSIDE a serialized
 * transaction alongside the row write. Side effects (badge + engine trigger)
 * go through announceQueueWrite() AFTER the transaction commits. Mutation
 * rotation matches medications.ts so a coalesced edit never reuses an
 * Idempotency-Key with a different payload hash (server 409s those).
 */
async function writeQueueRow(
  db: SyncDb,
  patientId: string,
  tableName: string,
  recordId: string,
  operation: 'create' | 'update' | 'delete',
  payload: Record<string, unknown> | null,
): Promise<void> {
  // Generate a unique mutation_id for this specific mutation
  // This is distinct from record_id (business record ID)
  const mutationId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM sync_queue WHERE table_name = ? AND record_id = ? AND status = ?',
    [tableName, recordId, 'pending'],
  );

  if (existing) {
    await db.runAsync(
      "UPDATE sync_queue SET operation = ?, mutation_id = ?, payload_json = ?, created_at = datetime('now'), patient_id = COALESCE(patient_id, ?) WHERE id = ?",
      [operation, mutationId, payload ? JSON.stringify(payload) : null, patientId, existing.id],
    );
  } else {
    await db.runAsync(
      'INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json, patient_id) VALUES (?, ?, ?, ?, ?, ?)',
      [tableName, recordId, mutationId, operation, payload ? JSON.stringify(payload) : null, patientId],
    );
  }
}

/** Post-commit side effects for a queued mutation (badge + engine trigger). */
function announceQueueWrite(): void {
  // Mark mutation as queued for UI display
  import('@/services/syncState').then(({ markMutationQueued }) => {
    markMutationQueued();
  });

  // Trigger sync asynchronously (fire-and-forget)
  // The sync engine's mutex prevents concurrent execution
  triggerSync();
}

// Trigger sync asynchronously after local mutation
function triggerSync(): void {
  import('@/services/syncEngine').then(({ syncPendingMutations }) => {
    syncPendingMutations().catch(() => {});
  });
}
