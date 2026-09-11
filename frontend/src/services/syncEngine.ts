/**
 * Generic offline sync engine.
 *
 * Connects the local encrypted SQLite database to the existing FastAPI backend.
 * Processes pending mutations from the sync_queue table.
 *
 * Strategy:
 *   - SQLite is the local working source of truth for user-authored offline data.
 *   - PostgreSQL remains the server source of truth.
 *   - The engine processes pending mutations in order.
 *   - Server ID reconciliation is handled after successful creation.
 *   - Idempotency is NOT guaranteed by the backend (no client-supplied IDs).
 *   - The engine marks mutations as synced on success.
 *
 * IMPORTANT:
 *   - Medication taken events use existing medication-specific reconciliation.
 *   - Document uploads are online-only (not processed by this engine).
 *   - Observations have no frontend user-authored mutation path.
 *   - _hydration rows are ignored (housekeeping).
 */

import { getDatabase } from '../db/connection';
import { api } from './api';
import { getCachedPatientId } from './patientIdentity';
import {
  markSyncing,
  refreshSyncState,
} from './syncState';
import {
  classifySyncError,
  computeBackoffDelayMs,
  isRetryableCategory,
  shouldExhaustRetries,
} from './syncClassification';
import { markOnline, markOffline } from './networkMonitor';
import type {
  SyncQueueItem,
  SyncResult,
  SyncState,
  SyncTableName,
} from './syncTypes';

// ============================================================================
// Constants
// ============================================================================

const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// In-memory retry backoff
// ============================================================================
// Sync triggers are frequent (startup, every foreground resume, network-
// recovery events, every local mutation). Without backoff, a queued mutation
// on a flaky connection is re-attempted on every trigger, generating noise
// and churning attempt_count. We remember when each item may next be
// retried (in-memory only; attempt_count persists across restarts so the
// exponent survives relaunches).

const _retryBackoff = new Map<number, number>(); // item id -> epoch ms

function scheduleRetry(id: number, attemptCount: number): void {
  const delay = computeBackoffDelayMs(
    attemptCount,
    BASE_RETRY_DELAY_MS,
    MAX_RETRY_DELAY_MS,
  );
  _retryBackoff.set(id, Date.now() + delay);
}

function clearRetryBackoff(id: number): void {
  _retryBackoff.delete(id);
}

function isRetryDue(id: number): boolean {
  const next = _retryBackoff.get(id);
  if (next === undefined) return true;
  if (Date.now() >= next) {
    _retryBackoff.delete(id);
    return true;
  }
  return false;
}

// ============================================================================
// Mutex
// ============================================================================

let syncMutex = false;

async function acquireLock(): Promise<boolean> {
  if (syncMutex) return false;
  syncMutex = true;
  return true;
}

function releaseLock(): void {
  syncMutex = false;
}

// ============================================================================
// Queue Operations
// ============================================================================

/**
 * Get all pending mutations from the sync queue.
 */
async function getPendingMutations(): Promise<SyncQueueItem[]> {
  const db = await getDatabase();

  return db.getAllAsync<SyncQueueItem>(
    `
    SELECT
      id, table_name, record_id, operation, payload_json,
      created_at, attempt_count, last_error, status
    FROM sync_queue
    WHERE status = 'pending'
      AND table_name != '_hydration'
    ORDER BY created_at ASC
    `,
  );
}

/**
 * Get a single queue item by ID.
 */
async function getQueueItem(id: number): Promise<SyncQueueItem | null> {
  const db = await getDatabase();

  return db.getFirstAsync<SyncQueueItem>(
    `
    SELECT
      id, table_name, record_id, operation, payload_json,
      created_at, attempt_count, last_error, status
    FROM sync_queue
    WHERE id = ?
    `,
    [id],
  );
}

/**
 * Update queue item status.
 */
async function updateQueueItem(
  id: number,
  status: 'processing' | 'completed' | 'failed' | 'pending',
  error?: string,
): Promise<void> {
  const db = await getDatabase();

  if (status === 'processing') {
    await db.runAsync(
      `
      UPDATE sync_queue
      SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL
      WHERE id = ?
      `,
      [id],
    );
  } else if (status === 'completed') {
    await db.runAsync(
      `
      UPDATE sync_queue
      SET status = 'completed', last_error = NULL
      WHERE id = ?
      `,
      [id],
    );
  } else if (status === 'failed') {
    await db.runAsync(
      `
      UPDATE sync_queue
      SET status = 'failed', last_error = ?
      WHERE id = ?
      `,
      [error ?? null, id],
    );
  } else if (status === 'pending') {
    // Transient failure: the mutation remains queued for automatic retry.
    // It stays visible as "Saved locally" (data is safe on device), NOT as
    // "needs attention". last_error preserves the safe diagnostic message.
    await db.runAsync(
      `
      UPDATE sync_queue
      SET status = 'pending', last_error = ?
      WHERE id = ?
      `,
      [error ?? null, id],
    );
  }
}

/**
 * Delete completed queue items older than 24 hours.
 */
async function cleanupCompletedItems(): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `
    DELETE FROM sync_queue
    WHERE status = 'completed'
      AND created_at < datetime('now', '-1 day')
    `,
  );
}

/**
 * Reset stale processing items back to pending.
 * Handles crashes that left items stuck in 'processing' state.
 */
async function recoverStaleProcessing(): Promise<number> {
  const db = await getDatabase();

  const result = await db.runAsync(
    `
    UPDATE sync_queue
    SET status = 'pending'
    WHERE status = 'processing'
      AND created_at < datetime('now', '-' || ? || ' seconds')
    `,
    [String(STALE_PROCESSING_THRESHOLD_MS / 1000)],
  );

  return result.changes;
}

// ============================================================================
// API Mappings
// ============================================================================

/**
 * Map sync_queue table_name + operation to API endpoint and method.
 */
function getEndpointConfig(
  tableName: SyncTableName,
  operation: string,
  payload: any,
): { method: string; url: string; buildBody?: (p: any) => any } | null {
  // Medications
  if (tableName === 'medications') {
    if (operation === 'create') {
      return {
        method: 'POST',
        url: '/api/v1/medications',
        buildBody: (p) => ({
          name: p.name,
          frequency: p.frequency,
          generic_name: p.generic_name,
          brand_name: p.brand_name,
          strength: p.strength,
          strength_unit: p.strength_unit,
          dose_amount: p.dose_amount,
          dose_unit: p.dose_unit,
          route: p.route,
          scheduled_times: p.scheduled_times,
          scheduled_weekdays: p.scheduled_weekdays,
          start_date: p.start_date,
          end_date: p.end_date,
          status: p.status,
          purpose: p.purpose,
          instructions: p.instructions,
          prescriber: p.prescriber,
          prn: p.prn,
          reminder_enabled: p.reminder_enabled,
          notes: p.notes,
          source_document_id: p.source_document_id,
        }),
      };
    }
    if (operation === 'update') {
      return {
        method: 'PUT',
        url: `/api/v1/medications/${payload.medication_id}`,
        buildBody: (p) => ({
          name: p.name,
          frequency: p.frequency,
          generic_name: p.generic_name,
          brand_name: p.brand_name,
          strength: p.strength,
          strength_unit: p.strength_unit,
          dose_amount: p.dose_amount,
          dose_unit: p.dose_unit,
          route: p.route,
          scheduled_times: p.scheduled_times,
          scheduled_weekdays: p.scheduled_weekdays,
          start_date: p.start_date,
          end_date: p.end_date,
          status: p.status,
          purpose: p.purpose,
          instructions: p.instructions,
          prescriber: p.prescriber,
          prn: p.prn,
          reminder_enabled: p.reminder_enabled,
          notes: p.notes,
        }),
      };
    }
    if (operation === 'delete') {
      return {
        method: 'DELETE',
        url: `/api/v1/medications/${payload.medication_id}`,
      };
    }
  }

  // Medication taken events — handled by existing medication reconciliation
  // Do NOT process via generic sync engine
  if (tableName === 'medication_taken_events') {
    return null;
  }

  // Daily logs
  if (tableName === 'daily_logs') {
    if (operation === 'create') {
      return {
        method: 'POST',
        url: '/api/v1/logs/daily-checkin',
        buildBody: (p) => ({
          log_date: p.log_date,
          overall_wellbeing: p.overall_wellbeing,
          energy_level: p.energy_level,
          stress_level: p.stress_level,
          sleep: p.sleep,
          nutrition: p.nutrition,
          notes: p.notes,
          symptoms: p.symptoms,
          vitals: p.vitals,
          pain: p.pain,
          activities: p.activities,
          medications: p.medications,
        }),
      };
    }
    if (operation === 'update') {
      return {
        method: 'PUT',
        url: `/api/v1/logs/daily-checkin/${payload.group_id}`,
        buildBody: (p) => ({
          log_date: p.log_date,
          overall_wellbeing: p.overall_wellbeing,
          energy_level: p.energy_level,
          stress_level: p.stress_level,
          sleep: p.sleep,
          nutrition: p.nutrition,
          notes: p.notes,
          symptoms: p.symptoms,
          vitals: p.vitals,
          pain: p.pain,
          activities: p.activities,
          medications: p.medications,
        }),
      };
    }
  }

  // Daily log events — child of daily_logs, created by parent endpoint
  // Do NOT process via generic sync engine
  if (tableName === 'daily_log_events') {
    return null;
  }

  // Hydration rows — housekeeping, not mutations
  if (tableName === '_hydration') {
    return null;
  }

  return null;
}

// ============================================================================
// Sync Engine
// ============================================================================

/**
 * Sync a single queue item to the server.
 */
async function syncRecord(item: SyncQueueItem): Promise<SyncResult> {
  const patientId = getCachedPatientId();

  // Patient isolation check
  if (!patientId) {
    return {
      success: false,
      queueItemId: item.id,
      tableName: item.table_name,
      operation: item.operation,
      recordId: item.record_id,
      error: 'No authenticated patient',
      errorCategory: 'auth',
    };
  }

  // Get endpoint config
  const payload = item.payload_json ? JSON.parse(item.payload_json) : null;
  const config = getEndpointConfig(item.table_name, item.operation, payload);

  if (!config) {
    // Skip non-syncable items (medication_taken_events, daily_log_events, _hydration)
    return {
      success: true,
      queueItemId: item.id,
      tableName: item.table_name,
      operation: item.operation,
      recordId: item.record_id,
    };
  }

  try {
    const { method, url, buildBody } = config;
    const body = buildBody ? buildBody(payload) : undefined;

    // Use the mutation_id as the idempotency key
    // This is distinct from record_id (business record ID)
    // For Daily Log UPDATE, multiple mutations can target the same group_id
    const idempotencyKey = item.mutation_id;

    let response: any;

    if (method === 'POST') {
      response = await api.post(url, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    } else if (method === 'PUT') {
      response = await api.put(url, body, {
        headers: { 'Idempotency-Key': idempotencyKey },
      });
    } else if (method === 'DELETE') {
      response = await api.delete(url);
    }

    // Extract server ID from response if available
    const serverId = response?.medication_id
      ?? response?.observation_id
      ?? response?.group_id
      ?? response?.document_id
      ?? null;

    return {
      success: true,
      queueItemId: item.id,
      tableName: item.table_name,
      operation: item.operation,
      recordId: item.record_id,
      serverId,
    };
  } catch (error: any) {
    const errorCategory = classifySyncError(error);

    // Do not store sensitive error details
    const safeError = errorCategory === 'permanent'
      ? `HTTP ${error?.response?.status}: ${error?.response?.statusText ?? 'Error'}`
      : errorCategory === 'auth'
        ? 'Authentication failed'
        : 'Sync failed';

    return {
      success: false,
      queueItemId: item.id,
      tableName: item.table_name,
      operation: item.operation,
      recordId: item.record_id,
      error: safeError,
      errorCategory,
    };
  }
}

/**
 * Reconcile server IDs after successful creation.
 * Updates the local record with the server-generated ID.
 */
async function reconcileServerId(
  tableName: string,
  localId: string,
  serverId: string,
): Promise<void> {
  const db = await getDatabase();

  // Update the record in the main table
  if (tableName === 'medications') {
    await db.runAsync(
      `
      UPDATE medications
      SET medication_id = ?, sync_status = 'synced'
      WHERE medication_id = ? AND sync_status != 'synced'
      `,
      [serverId, localId],
    );
  } else if (tableName === 'daily_logs') {
    await db.runAsync(
      `
      UPDATE daily_logs
      SET group_id = ?, sync_status = 'synced'
      WHERE group_id = ? AND sync_status != 'synced'
      `,
      [serverId, localId],
    );
  }
}

/**
 * Process a single queue item with retry logic.
 *
 * Failure classification:
 *   - permanent / auth  -> status 'failed' (needs attention, no auto-retry;
 *                          the user can Retry, which resets to pending)
 *   - retryable, or conflict/unknown below max attempts -> status 'pending'
 *     (data stays safe on device; automatic retry continues with backoff)
 *   - conflict/unknown that exhausted MAX_RETRY_ATTEMPTS -> status 'failed'
 *
 * Transient (network-class) failures deliberately never exhaust: an offline
 * device must be able to hold mutations as "Saved locally" indefinitely.
 */
async function processQueueItem(item: SyncQueueItem): Promise<SyncResult> {
  // Mark as processing (attempt_count += 1) and sync to server
  await updateQueueItem(item.id, 'processing');

  // Sync to server
  const result = await syncRecord(item);

  if (result.success) {
    // Reconcile server IDs if needed
    if (result.serverId && result.serverId !== item.record_id) {
      await reconcileServerId(
        item.table_name,
        item.record_id,
        result.serverId,
      );
    }

    // Mark as completed
    await updateQueueItem(item.id, 'completed');
    clearRetryBackoff(item.id);

    // Update the main record's sync_status
    await markRecordSynced(item.table_name, item.record_id);
  } else if (result.errorCategory === 'permanent' || result.errorCategory === 'auth') {
    // Permanent failure — mark as failed, no automatic retry
    await updateQueueItem(item.id, 'failed', result.error);
    clearRetryBackoff(item.id);
  } else {
    // Retryable failure — keep the item queued (status 'pending') and
    // schedule the next automatic attempt with exponential backoff.
    const errorCategory = result.errorCategory ?? 'unknown';
    const attemptNumber = item.attempt_count + 1;
    const retryable = isRetryableCategory(errorCategory);
    const exhausted =
      retryable &&
      shouldExhaustRetries(attemptNumber, errorCategory, MAX_RETRY_ATTEMPTS);

    if (exhausted) {
      // conflict/unknown kept failing past the cap — surface for attention
      await updateQueueItem(item.id, 'failed', result.error);
      clearRetryBackoff(item.id);
    } else {
      await updateQueueItem(item.id, 'pending', result.error);
      scheduleRetry(item.id, attemptNumber);
    }
  }

  return result;
}

/**
 * Mark a record in the main table as synced.
 */
async function markRecordSynced(
  tableName: string,
  recordId: string,
): Promise<void> {
  const db = await getDatabase();

  if (tableName === 'medications') {
    await db.runAsync(
      `
      UPDATE medications
      SET sync_status = 'synced'
      WHERE medication_id = ? AND sync_status != 'synced'
      `,
      [recordId],
    );
  } else if (tableName === 'daily_logs') {
    await db.runAsync(
      `
      UPDATE daily_logs
      SET sync_status = 'synced'
      WHERE group_id = ? AND sync_status != 'synced'
      `,
      [recordId],
    );
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Sync all pending mutations to the server.
 *
 * This is the main entry point for the sync engine.
 * It can be invoked:
 *   - when app becomes active
 *   - after a successful API operation
 *   - after local mutation
 *   - manually from development/testing
 *
 * Safe to call multiple times (uses mutex to prevent concurrent execution).
 */
export async function syncPendingMutations(): Promise<SyncResult[]> {
  // Acquire lock
  if (!(await acquireLock())) {
    return [];
  }

  const results: SyncResult[] = [];

  try {
    // Verify authentication
    const patientId = getCachedPatientId();
    if (!patientId) {
      return [];
    }

    // Mark sync as started
    markSyncing();

    // Recover stale processing items
    await recoverStaleProcessing();

    // Get pending mutations (only 'pending' — 'failed' rows need explicit
    // attention and are recovered via retryFailedSyncs / the Retry button)
    const pending = await getPendingMutations();

    // Respect backoff: skip items whose next automatic attempt isn't due yet
    const due = pending.filter((item) => isRetryDue(item.id));

    // Process items in order
    for (const item of due) {
      // Re-check authentication before each item
      if (!getCachedPatientId()) {
        break;
      }

      const result = await processQueueItem(item);
      results.push(result);

      // Stop on auth failure
      if (result.errorCategory === 'auth') {
        break;
      }
    }

    // Cleanup old completed items
    await cleanupCompletedItems();
  } finally {
    releaseLock();
  }

  // Reconcile the network monitor with this run's outcome.
  // A network-class failure means connectivity is suspect (stop hammering an
  // unreachable server with every sync trigger); otherwise we're online.
  const hadNetworkFailure = results.some(
    (r) => r.errorCategory === 'retryable',
  );
  if (hadNetworkFailure) {
    markOffline();
  } else if (results.length > 0) {
    markOnline();
  }

  // Commit sync state AFTER releasing the lock so isSyncing resolves to the
  // real outcome (SYNCED / SAVED_LOCALLY / SYNC_FAILED) instead of sticking
  // on "Syncing…" because the mutex was still held. failedCount>0 reflects
  // only genuine attention cases (permanent/auth/exhausted rows).
  await refreshSyncState();

  return results;
}

/**
 * Get current sync state.
 */
export async function getSyncState(): Promise<SyncState> {
  const db = await getDatabase();

  const counts = await db.getFirstAsync<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }>(
    `
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM sync_queue
    WHERE table_name != '_hydration'
    `,
  );

  return {
    pendingCount: counts?.pending ?? 0,
    processingCount: counts?.processing ?? 0,
    completedCount: counts?.completed ?? 0,
    failedCount: counts?.failed ?? 0,
    lastSyncAttempt: null,
    lastSyncSuccess: null,
    isSyncing: syncMutex,
  };
}

/**
 * Retry failed sync items.
 * Resets attempt count and sets status back to pending.
 */
export async function retryFailedSyncs(): Promise<number> {
  const db = await getDatabase();

  const result = await db.runAsync(
    `
    UPDATE sync_queue
    SET status = 'pending', attempt_count = 0
    WHERE status = 'failed'
      AND table_name != '_hydration'
    `,
  );

  return result.changes;
}

/**
 * Clear all sync queue items (for logout/testing).
 */
export async function clearSyncQueue(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM sync_queue`);
}
