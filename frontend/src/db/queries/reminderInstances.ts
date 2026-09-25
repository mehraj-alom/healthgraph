/**
 * reminderInstances.ts — reminder occurrence tracking (device-only).
 *
 * The medication schedule stays the source of truth. This table only
 * records what the OS scheduler was asked to fire (plus snooze rows) so
 * reconciliation can diff desired vs actual without a second schedule
 * database. Patient-scoped, never synced, wiped with the patient row.
 *
 * Node-testable by design: logic takes an explicit database handle and
 * this module has zero runtime imports (production entry points resolve
 * the encrypted database lazily).
 */

export type ReminderInstanceStatus =
  | 'scheduled'
  | 'fired'
  | 'snoozed'
  | 'dismissed'
  | 'taken';

export interface ReminderInstance {
  occurrence_id: string;
  patient_id: string;
  medication_id: string;
  scheduled_at: string;
  scheduled_time: string;
  status: ReminderInstanceStatus;
  snooze_count: number;
  parent_occurrence_id: string | null;
  notification_id: string | null;
  created_at: string;
}

export interface ReminderDb {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
}

const VALID_STATUSES: readonly string[] = [
  'scheduled',
  'fired',
  'snoozed',
  'dismissed',
  'taken',
];

/** Upsert one instance (insert or replace the same occurrence id). */
export async function upsertReminderInstanceDb(
  db: ReminderDb,
  instance: Omit<ReminderInstance, 'created_at'>,
): Promise<void> {
  if (!VALID_STATUSES.includes(instance.status)) {
    throw new Error('Invalid reminder instance status.');
  }
  await db.runAsync(
    `INSERT INTO reminder_instances
       (occurrence_id, patient_id, medication_id, scheduled_at,
        scheduled_time, status, snooze_count, parent_occurrence_id,
        notification_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(occurrence_id) DO UPDATE SET
       scheduled_at = excluded.scheduled_at,
       scheduled_time = excluded.scheduled_time,
       status = excluded.status,
       snooze_count = excluded.snooze_count,
       parent_occurrence_id = excluded.parent_occurrence_id,
       notification_id = excluded.notification_id`,
    instance.occurrence_id,
    instance.patient_id,
    instance.medication_id,
    instance.scheduled_at,
    instance.scheduled_time,
    instance.status,
    instance.snooze_count,
    instance.parent_occurrence_id,
    instance.notification_id,
  );
}

/** All instances for a patient at/after a cutoff ISO instant, ascending. */
export async function listReminderInstancesFromDb(
  db: ReminderDb,
  patientId: string,
  fromIso: string,
): Promise<ReminderInstance[]> {
  return db.getAllAsync<ReminderInstance>(
    `SELECT occurrence_id, patient_id, medication_id, scheduled_at,
            scheduled_time, status, snooze_count, parent_occurrence_id,
            notification_id, created_at
       FROM reminder_instances
      WHERE patient_id = ? AND scheduled_at >= ?
      ORDER BY scheduled_at ASC`,
    patientId,
    fromIso,
  );
}

/** One instance by occurrence id, patient-scoped. */
export async function getReminderInstanceDb(
  db: ReminderDb,
  patientId: string,
  occurrenceId: string,
): Promise<ReminderInstance | null> {
  return db.getFirstAsync<ReminderInstance>(
    `SELECT occurrence_id, patient_id, medication_id, scheduled_at,
            scheduled_time, status, snooze_count, parent_occurrence_id,
            notification_id, created_at
       FROM reminder_instances
      WHERE patient_id = ? AND occurrence_id = ?`,
    patientId,
    occurrenceId,
  );
}

/** Mark one instance's status (taken/dismissed/fired), patient-scoped. */
export async function setReminderInstanceStatusDb(
  db: ReminderDb,
  patientId: string,
  occurrenceId: string,
  status: ReminderInstanceStatus,
): Promise<boolean> {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error('Invalid reminder instance status.');
  }
  const r = await db.runAsync(
    `UPDATE reminder_instances SET status = ?
      WHERE patient_id = ? AND occurrence_id = ?`,
    status,
    patientId,
    occurrenceId,
  );
  return Number(r.changes ?? 0) > 0;
}

/** Drop rows older than a cutoff ISO instant (horizon pruning). */
export async function pruneReminderInstancesDb(
  db: ReminderDb,
  patientId: string,
  beforeIso: string,
): Promise<number> {
  const r = await db.runAsync(
    `DELETE FROM reminder_instances WHERE patient_id = ? AND scheduled_at < ?`,
    patientId,
    beforeIso,
  );
  return Number(r.changes ?? 0);
}

// ---------------------------------------------------------------------------
// Production entry points (lazy connection)
// ---------------------------------------------------------------------------

async function getDb(): Promise<ReminderDb> {
  const { getDatabase } = await import('@/db/connection');
  return (await getDatabase()) as unknown as ReminderDb;
}

export async function upsertReminderInstance(
  instance: Omit<ReminderInstance, 'created_at'>,
): Promise<void> {
  return upsertReminderInstanceDb(await getDb(), instance);
}

export async function listReminderInstancesFrom(
  patientId: string,
  fromIso: string,
): Promise<ReminderInstance[]> {
  return listReminderInstancesFromDb(await getDb(), patientId, fromIso);
}

export async function getReminderInstance(
  patientId: string,
  occurrenceId: string,
): Promise<ReminderInstance | null> {
  return getReminderInstanceDb(await getDb(), patientId, occurrenceId);
}

export async function setReminderInstanceStatus(
  patientId: string,
  occurrenceId: string,
  status: ReminderInstanceStatus,
): Promise<boolean> {
  return setReminderInstanceStatusDb(await getDb(), patientId, occurrenceId, status);
}

export async function pruneReminderInstances(
  patientId: string,
  beforeIso: string,
): Promise<number> {
  return pruneReminderInstancesDb(await getDb(), patientId, beforeIso);
}
