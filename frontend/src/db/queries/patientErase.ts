/**
 * patientErase.ts — local SQLite wipe for one patient (deletion support).
 *
 * Removes every patient-scoped health row plus caches and queue entries so
 * that after a server-side erasure nothing of the patient remains on device
 * (and nothing can leak into another account or resurface through stale
 * hooks). Non-health configuration is preserved: the SQLCipher key, anatomy
 * GLB cache, RPPG model cache, and global UI prefs are untouched.
 *
 * Every statement is patient-scoped; legacy sync_queue rows without an owner
 * are deleted only when their payload attributes them to this patient
 * (truly unattributable rows fail closed and stay, exactly like the sync
 * backstop). All deletes are idempotent — safe to retry.
 *
 * Node-testable by design: the wipe logic takes an explicit database handle
 * (wipePatientTables) and this module has zero runtime imports, so unit
 * tests execute the REAL deletes against in-memory SQLite. The production
 * entry point (deletePatientLocalData) resolves the encrypted database
 * lazily — same pattern as heartRate.ts.
 */

export type LocalEraseCounts = Record<string, number>;

/** Minimal structural surface of the SQLite handle the wipe needs. */
export interface PatientEraseDb {
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: unknown }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

/** Health tables carrying a patient_id column (mirrors migrations.ts). */
const PATIENT_TABLES: readonly string[] = [
  'medications',
  'medication_taken_events',
  'daily_logs',
  'observations',
  'body_state_snapshots',
  'documents',
  'profile_cache',
  'daily_metrics_cache',
  'trends_cache',
  'trends_cache_new',
  'scan_sessions',
  'ppg_measurements',
  'rppg_measurements',
  'substance_entries',
  'cycle_entries',
  'food_scan_items',
  'onboarding_state',
];

/**
 * Execute the wipe against an explicit handle (test seam + production body).
 * Every statement is patient-scoped; returns per-table counts only.
 */
export async function wipePatientTables(
  db: PatientEraseDb,
  patientId: string,
): Promise<LocalEraseCounts> {
  const counts: LocalEraseCounts = {};
  const wipe = async (table: string, sql: string, params: (string | number | null)[]) => {
    const r = await db.runAsync(sql, ...params);
    counts[table] = (counts[table] ?? 0) + Number(r.changes ?? 0);
  };

  // Child rows first (events reference groups; kept consistent even though
  // no FK enforcement is relied upon).
  await wipe(
    'daily_log_events',
    'DELETE FROM daily_log_events WHERE group_id IN (SELECT group_id FROM daily_logs WHERE patient_id = ?)',
    [patientId],
  );
  await wipe('daily_logs', 'DELETE FROM daily_logs WHERE patient_id = ?', [patientId]);
  for (const table of PATIENT_TABLES) {
    await wipe(table, `DELETE FROM ${table} WHERE patient_id = ?`, [patientId]);
  }

  // Taken-events hydration flag for this patient (scope is fixed; the key
  // embeds the patient id — see medicationTakenEvents.getHydrationKey).
  await wipe(
    'hydration_state',
    "DELETE FROM hydration_state WHERE scope = 'taken-events' AND key = ?",
    [`taken_hydrated:${patientId}`],
  );

  // Sync queue: owned rows plus legacy rows attributed via payload backstop.
  // Unattributable legacy rows fail closed (stay) — they can never sync
  // under another session (shouldSyncQueueItem) and carry no owner to wipe.
  await wipe('sync_queue', 'DELETE FROM sync_queue WHERE patient_id = ?', [patientId]);
  const legacy = await db.getAllAsync<{ id: number; payload_json: string | null }>(
    'SELECT id, payload_json FROM sync_queue WHERE patient_id IS NULL',
  );
  let legacyDeleted = 0;
  for (const row of legacy) {
    try {
      const payload = row.payload_json
        ? (JSON.parse(row.payload_json) as { patient_id?: unknown })
        : null;
      if (payload && payload.patient_id === patientId) {
        await db.runAsync('DELETE FROM sync_queue WHERE id = ?', row.id);
        legacyDeleted += 1;
      }
    } catch {
      // Unparsable payload carries no attributable owner — keep (fail closed).
    }
  }
  counts['sync_queue_legacy'] = legacyDeleted;
  return counts;
}

/**
 * Delete all local data for a patient. Returns per-table deleted counts
 * (counts only — never health content).
 */
export async function deletePatientLocalData(patientId: string): Promise<LocalEraseCounts> {
  const { getDatabase } = await import('@/db/connection');
  const db = await getDatabase();
  return wipePatientTables(db as unknown as PatientEraseDb, patientId);
}
