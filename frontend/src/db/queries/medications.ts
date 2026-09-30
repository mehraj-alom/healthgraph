/**
 * medications.ts — Local SQLite repository for Medication entities.
 *
 * All queries are scoped to the authenticated patient via patient_id.
 * SQLite is the source of truth for reads. Writes go to SQLite immediately
 * with sync_status tracking for future server synchronization.
 */

import { getDatabase, withSerializedTransaction } from '@/db/connection';
import type {
  Medication,
  MedicationStatus,
  MedicationFrequency,
  MedicationRoute,
  ActiveMedicationForDailyLog,
} from '@/types';

// ─── JSON Helpers ────────────────────────────────────────────────────────────

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseNumberArray(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeJsonArray(value: string[] | null): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

function serializeNumberArray(value: number[] | null): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}

// ─── Row → Medication Mapping ────────────────────────────────────────────────

interface MedicationRow {
  medication_id: string;
  patient_id: string;
  name: string;
  generic_name: string | null;
  brand_name: string | null;
  strength: string | null;
  strength_unit: string | null;
  dose_amount: number | null;
  dose_unit: string | null;
  route: string | null;
  frequency: string;
  scheduled_times: string | null;
  scheduled_weekdays: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  purpose: string | null;
  instructions: string | null;
  prescriber: string | null;
  prn: number;
  reminder_enabled: number;
  notes: string | null;
  source_document_id: string | null;
  supply_quantity: number | null;
  supply_started_on: string | null;
  refills_left: number | null;
  created_at: string;
  updated_at: string;
  local_id: string | null;
  sync_status: string;
  server_revision: number | null;
}

function rowToMedication(row: MedicationRow): Medication {
  return {
    medication_id: row.medication_id,
    patient_id: row.patient_id,
    name: row.name,
    generic_name: row.generic_name,
    brand_name: row.brand_name,
    strength: row.strength,
    strength_unit: row.strength_unit,
    dose_amount: row.dose_amount,
    dose_unit: row.dose_unit,
    route: row.route as MedicationRoute | null,
    frequency: row.frequency as MedicationFrequency,
    scheduled_times: parseJsonArray(row.scheduled_times),
    scheduled_weekdays: parseNumberArray(row.scheduled_weekdays),
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status as MedicationStatus,
    purpose: row.purpose,
    instructions: row.instructions,
    prescriber: row.prescriber,
    prn: row.prn === 1,
    reminder_enabled: row.reminder_enabled === 1,
    notes: row.notes,
    source_document_id: row.source_document_id,
    supply_quantity: row.supply_quantity,
    supply_started_on: row.supply_started_on,
    refills_left: row.refills_left,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Row → ActiveMedicationForDailyLog Mapping ───────────────────────────────

function rowToActiveMedication(row: MedicationRow): ActiveMedicationForDailyLog {
  return {
    medication_id: row.medication_id,
    name: row.name,
    strength: row.strength,
    strength_unit: row.strength_unit,
    dose_amount: row.dose_amount,
    dose_unit: row.dose_unit,
    frequency: row.frequency as MedicationFrequency,
    scheduled_times: parseJsonArray(row.scheduled_times),
    route: row.route as MedicationRoute | null,
    prn: row.prn === 1,
  };
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Get all medications for a patient, optionally filtered by status.
 */
export async function getMedications(
  patientId: string,
  status?: MedicationStatus,
): Promise<Medication[]> {
  const db = await getDatabase();
  let query = 'SELECT * FROM medications WHERE patient_id = ?';
  const params: (string | number)[] = [patientId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY name ASC';

  const result = await db.getAllAsync<MedicationRow>(query, params);
  return result.map(rowToMedication);
}

/**
 * Get all active medications for a patient.
 */
export async function getActiveMedications(
  patientId: string,
): Promise<Medication[]> {
  return getMedications(patientId, 'ACTIVE');
}

/**
 * Get a single medication by ID, scoped to patient.
 */
export async function getMedicationById(
  patientId: string,
  medicationId: string,
): Promise<Medication | null> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<MedicationRow>(
    'SELECT * FROM medications WHERE patient_id = ? AND medication_id = ?',
    [patientId, medicationId],
  );
  return result ? rowToMedication(result) : null;
}

/**
 * Get active medications formatted for the daily log.
 */
export async function getActiveMedicationsForDailyLog(
  patientId: string,
): Promise<ActiveMedicationForDailyLog[]> {
  const db = await getDatabase();
  const result = await db.getAllAsync<MedicationRow>(
    "SELECT * FROM medications WHERE patient_id = ? AND status = 'ACTIVE' ORDER BY name ASC",
    [patientId],
  );
  return result.map(rowToActiveMedication);
}

// ─── Write Operations ────────────────────────────────────────────────────────

function generateLocalId(): string {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Insert a new medication into local SQLite.
 * Sets sync_status = 'pending_create' for future server hydration.
 * Returns the medication_id (local UUID) for immediate use.
 */
export async function insertMedication(
  patientId: string,
  medication: Omit<Medication, 'medication_id' | 'patient_id' | 'created_at' | 'updated_at'>,
): Promise<string> {
  const db = await getDatabase();
  const localId = generateLocalId();
  const now = nowIso();

  // Atomic: the row and its queue entry commit together. A crash between
  // them would leave a pending_create row with no queue entry — stuck
  // unsynced forever, since the engine only processes queue rows and
  // hydration skips non-synced rows.
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO medications (
      medication_id, patient_id, name, generic_name, brand_name,
      strength, strength_unit, dose_amount, dose_unit, route,
      frequency, scheduled_times, scheduled_weekdays, start_date, end_date,
      status, purpose, instructions, prescriber, prn,
      reminder_enabled, notes, source_document_id, supply_quantity, supply_started_on, refills_left,
      created_at, updated_at,
      local_id, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
    [
      localId,
      patientId,
      medication.name,
      medication.generic_name,
      medication.brand_name,
      medication.strength,
      medication.strength_unit,
      medication.dose_amount,
      medication.dose_unit,
      medication.route,
      medication.frequency,
      serializeJsonArray(medication.scheduled_times),
      serializeNumberArray(medication.scheduled_weekdays),
      medication.start_date,
      medication.end_date,
      medication.status,
      medication.purpose,
      medication.instructions,
      medication.prescriber,
      medication.prn ? 1 : 0,
      medication.reminder_enabled ? 1 : 0,
      medication.notes,
      medication.source_document_id,
      medication.supply_quantity,
      medication.supply_started_on,
      medication.refills_left,
      now,
      now,
      localId,
    ],
    );

    // Queue row joins the SAME transaction (never a nested one — nested
    // serialized transactions deadlock the chain mutex).
    await writeQueueRow(db, patientId, 'medications', localId, 'create', {
      ...medication,
      medication_id: localId,
      patient_id: patientId,
      created_at: now,
      updated_at: now,
    });
  });

  // Side effects only after commit: badge + engine trigger must never run
  // inside the transaction.
  announceQueueWrite();

  return localId;
}

/**
 * Update an existing medication in local SQLite.
 * Sets sync_status = 'pending_update' for future server hydration.
 */
export async function updateMedication(
  patientId: string,
  medicationId: string,
  updates: Partial<Omit<Medication, 'medication_id' | 'patient_id' | 'created_at' | 'updated_at'>>,
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { setClauses.push('name = ?'); params.push(updates.name); }
  if (updates.generic_name !== undefined) { setClauses.push('generic_name = ?'); params.push(updates.generic_name); }
  if (updates.brand_name !== undefined) { setClauses.push('brand_name = ?'); params.push(updates.brand_name); }
  if (updates.strength !== undefined) { setClauses.push('strength = ?'); params.push(updates.strength); }
  if (updates.strength_unit !== undefined) { setClauses.push('strength_unit = ?'); params.push(updates.strength_unit); }
  if (updates.dose_amount !== undefined) { setClauses.push('dose_amount = ?'); params.push(updates.dose_amount); }
  if (updates.dose_unit !== undefined) { setClauses.push('dose_unit = ?'); params.push(updates.dose_unit); }
  if (updates.route !== undefined) { setClauses.push('route = ?'); params.push(updates.route); }
  if (updates.frequency !== undefined) { setClauses.push('frequency = ?'); params.push(updates.frequency); }
  if (updates.scheduled_times !== undefined) { setClauses.push('scheduled_times = ?'); params.push(serializeJsonArray(updates.scheduled_times)); }
  if (updates.scheduled_weekdays !== undefined) { setClauses.push('scheduled_weekdays = ?'); params.push(serializeNumberArray(updates.scheduled_weekdays)); }
  if (updates.start_date !== undefined) { setClauses.push('start_date = ?'); params.push(updates.start_date); }
  if (updates.end_date !== undefined) { setClauses.push('end_date = ?'); params.push(updates.end_date); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.purpose !== undefined) { setClauses.push('purpose = ?'); params.push(updates.purpose); }
  if (updates.instructions !== undefined) { setClauses.push('instructions = ?'); params.push(updates.instructions); }
  if (updates.prescriber !== undefined) { setClauses.push('prescriber = ?'); params.push(updates.prescriber); }
  if (updates.prn !== undefined) { setClauses.push('prn = ?'); params.push(updates.prn ? 1 : 0); }
  if (updates.reminder_enabled !== undefined) { setClauses.push('reminder_enabled = ?'); params.push(updates.reminder_enabled ? 1 : 0); }
  if (updates.notes !== undefined) { setClauses.push('notes = ?'); params.push(updates.notes); }
  if (updates.source_document_id !== undefined) { setClauses.push('source_document_id = ?'); params.push(updates.source_document_id); }
  if (updates.supply_quantity !== undefined) { setClauses.push('supply_quantity = ?'); params.push(updates.supply_quantity); }
  if (updates.supply_started_on !== undefined) { setClauses.push('supply_started_on = ?'); params.push(updates.supply_started_on); }
  if (updates.refills_left !== undefined) { setClauses.push('refills_left = ?'); params.push(updates.refills_left); }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = ?');
  params.push(now);

  // Mark as pending update unless already pending create
  setClauses.push("sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_update' END");

  params.push(patientId, medicationId);

  let queued = false;
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `UPDATE medications SET ${setClauses.join(', ')} WHERE patient_id = ? AND medication_id = ?`,
      params,
    );

    // Add to sync queue (same transaction as the row write)
    const current = await getMedicationById(patientId, medicationId);
    if (current) {
      await writeQueueRow(db, patientId, 'medications', medicationId, 'update', {
        ...current,
        ...updates,
        medication_id: medicationId,
        patient_id: patientId,
        updated_at: now,
      });
      queued = true;
    }
  });
  if (queued) announceQueueWrite();
}

/**
 * Mirror a server-confirmed status change locally WITHOUT touching
 * sync_status or the queue (the server already applied it — queueing
 * would replay the mutation). Used after pause/resume/stop succeed.
 */
export async function markMedicationStatusLocal(
  patientId: string,
  medicationId: string,
  status: MedicationStatus,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE medications SET status = ?, updated_at = ?
      WHERE patient_id = ? AND medication_id = ?`,
    [status, nowIso(), patientId, medicationId],
  );
}

/**
 * Soft-delete a medication by setting status = 'DISCONTINUED' and sync_status = 'pending_delete'.
 * Does not remove the record (preserves data for sync).
 */
export async function deleteMedication(
  patientId: string,
  medicationId: string,
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `UPDATE medications
       SET status = 'DISCONTINUED',
           updated_at = ?,
           sync_status = CASE WHEN sync_status = 'pending_create' THEN 'pending_create' ELSE 'pending_delete' END
       WHERE patient_id = ? AND medication_id = ?`,
      [now, patientId, medicationId],
    );

    // Add to sync queue (same transaction as the row write)
    await writeQueueRow(db, patientId, 'medications', medicationId, 'delete', null);
  });
  announceQueueWrite();
}

/**
 * Hydrate medications from server data.
 * Does not overwrite locally pending mutations.
 */
export async function hydrateMedications(
  patientId: string,
  serverMedications: Medication[],
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  // One transaction for the whole batch: atomic and far fewer round-trips
  // than per-medication commits. Logic per row is unchanged.
  await withSerializedTransaction(db, async () => {
  for (const med of serverMedications) {
    // Check if local record exists with pending mutation
    const existing = await db.getFirstAsync<{ sync_status: string }>(
      'SELECT sync_status FROM medications WHERE medication_id = ?',
      [med.medication_id],
    );

    if (existing && existing.sync_status !== 'synced') {
      // Skip — local mutation takes priority
      continue;
    }

    // Upsert: insert or update synced records
    await db.runAsync(
      `INSERT INTO medications (
        medication_id, patient_id, name, generic_name, brand_name,
        strength, strength_unit, dose_amount, dose_unit, route,
        frequency, scheduled_times, scheduled_weekdays, start_date, end_date,
        status, purpose, instructions, prescriber, prn,
        reminder_enabled, notes, source_document_id, supply_quantity, supply_started_on, refills_left,
        created_at, updated_at,
        sync_status, server_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL)
      ON CONFLICT(medication_id) DO UPDATE SET
        patient_id = excluded.patient_id,
        name = excluded.name,
        generic_name = excluded.generic_name,
        brand_name = excluded.brand_name,
        strength = excluded.strength,
        strength_unit = excluded.strength_unit,
        dose_amount = excluded.dose_amount,
        dose_unit = excluded.dose_unit,
        route = excluded.route,
        frequency = excluded.frequency,
        scheduled_times = excluded.scheduled_times,
        scheduled_weekdays = excluded.scheduled_weekdays,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        purpose = excluded.purpose,
        instructions = excluded.instructions,
        prescriber = excluded.prescriber,
        prn = excluded.prn,
        reminder_enabled = excluded.reminder_enabled,
        notes = excluded.notes,
        source_document_id = excluded.source_document_id,
        supply_quantity = excluded.supply_quantity,
        supply_started_on = excluded.supply_started_on,
        refills_left = excluded.refills_left,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        sync_status = 'synced',
        server_revision = NULL
      WHERE sync_status = 'synced'`,
      [
        med.medication_id,
        patientId,
        med.name,
        med.generic_name,
        med.brand_name,
        med.strength,
        med.strength_unit,
        med.dose_amount,
        med.dose_unit,
        med.route,
        med.frequency,
        serializeJsonArray(med.scheduled_times),
        serializeNumberArray(med.scheduled_weekdays),
        med.start_date,
        med.end_date,
        med.status,
        med.purpose,
        med.instructions,
        med.prescriber,
        med.prn ? 1 : 0,
        med.reminder_enabled ? 1 : 0,
        med.notes,
        med.source_document_id,
        med.supply_quantity,
        med.supply_started_on,
        med.refills_left,
        med.created_at,
        med.updated_at,
      ],
    );
  }
  });
}

// ─── Sync Queue ──────────────────────────────────────────────────────────────

type SyncDb = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Queue-row SQL only (no side effects): safe to call INSIDE a serialized
 * transaction alongside the row write. Side effects (badge + engine trigger)
 * go through announceQueueWrite() AFTER the transaction commits — never
 * inside it.
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

  // Check for existing pending entry for this record
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM sync_queue WHERE table_name = ? AND record_id = ? AND status = ?',
    [tableName, recordId, 'pending'],
  );

  if (existing) {
    // Update existing entry instead of creating duplicate.
    // Rotate mutation_id: it is used as the Idempotency-Key, and the
    // server 409s when a reused key carries a different payload hash.
    // Heal ownership for legacy rows that predate the patient_id column.
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
