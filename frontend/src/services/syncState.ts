/**
 * Minimal sync state for UI display.
 *
 * Tracks user-meaningful sync status without exposing internal queue details.
 * Uses pub/sub pattern for reactive updates.
 *
 * States:
 *   - SYNCED: All mutations synced
 *   - SYNCING: Sync in progress
 *   - SAVED_LOCALLY: Mutations queued, not yet synced
 *   - SYNC_FAILED: Permanent sync failure requiring attention
 */

import { deriveSyncStatus } from './syncClassification';

// ============================================================================
// Types
// ============================================================================

export type SyncStatus = 'SYNCED' | 'SYNCING' | 'SAVED_LOCALLY' | 'SYNC_FAILED';

export interface SyncDisplayState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncSuccess: number | null;
  lastErrorCategory: string | null;
}

type Listener = (state: SyncDisplayState) => void;

// ============================================================================
// State
// ============================================================================

let _state: SyncDisplayState = {
  status: 'SYNCED',
  pendingCount: 0,
  lastSyncSuccess: null,
  lastErrorCategory: null,
};

let _listeners: Set<Listener> = new Set();
let _initialized = false;

// ============================================================================
// Public API
// ============================================================================

/**
 * Get current sync display state.
 */
export function getSyncDisplayState(): SyncDisplayState {
  return _state;
}

/**
 * Subscribe to sync state changes.
 * Returns unsubscribe function.
 */
export function subscribeSyncState(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Initialize sync state from database.
 * Call once on app startup after authentication.
 */
export async function initSyncState(): Promise<void> {
  if (_initialized) return;
  _initialized = true;
  await refreshSyncState();
}

/**
 * Refresh sync state from database.
 * Call after mutations or sync operations.
 *
 * NOTE: the engine is imported dynamically (not statically) because
 * syncEngine statically imports this module — a static import back would
 * recreate the Metro require cycle
 * (syncEngine -> syncState -> syncEngine).
 */
export async function refreshSyncState(): Promise<void> {
  try {
    const { getSyncState } = await import('./syncEngine');
    const dbState = await getSyncState();

    // Derived purely from queue counts: 'failed' rows are the only source of
    // SYNC_FAILED ("Sync needs attention") — transient retryable failures
    // never leave 'pending', so they show as SAVED_LOCALLY ("Saved locally").
    const status = deriveSyncStatus({
      pendingCount: dbState.pendingCount,
      failedCount: dbState.failedCount,
      isSyncing: dbState.isSyncing,
    });

    _state = {
      status,
      pendingCount: dbState.pendingCount,
      lastSyncSuccess: dbState.lastSyncSuccess,
      lastErrorCategory: null,
    };

    _notifyListeners();
  } catch {
    // Database not available yet
  }
}

/**
 * Mark sync as started.
 */
export function markSyncing(): void {
  if (_state.status !== 'SYNCING') {
    _state = { ..._state, status: 'SYNCING' };
    _notifyListeners();
  }
}

/**
 * Mark a mutation as queued.
 */
export function markMutationQueued(): void {
  if (_state.status === 'SYNCED') {
    _state = { ..._state, status: 'SAVED_LOCALLY', pendingCount: _state.pendingCount + 1 };
    _notifyListeners();
  } else if (_state.status === 'SAVED_LOCALLY') {
    _state = { ..._state, pendingCount: _state.pendingCount + 1 };
    _notifyListeners();
  }
}

/**
 * Clear sync state on logout.
 */
export function clearSyncState(): void {
  _state = {
    status: 'SYNCED',
    pendingCount: 0,
    lastSyncSuccess: null,
    lastErrorCategory: null,
  };
  _initialized = false;
  _notifyListeners();
}

/**
 * Retry sync after failure.
 * Verifies authentication and network, then resets failed items back to
 * pending (fresh attempts) and runs a sync pass.
 */
export async function retrySync(): Promise<void> {
  const { getCachedPatientId } = await import('./patientIdentity');
  const { isOnline } = await import('./networkMonitor');
  const { syncPendingMutations, retryFailedSyncs } = await import('./syncEngine');

  // Verify authentication
  if (!getCachedPatientId()) {
    return;
  }

  // Verify network
  if (!isOnline()) {
    return;
  }

  // Reset permanent/auth 'failed' rows so the sync pass actually attempts
  // them again (without this, failed rows were stuck with no way to recover
  // from the UI).
  await retryFailedSyncs();

  // Retry sync
  await syncPendingMutations();
}

// ============================================================================
// Internal
// ============================================================================

function _notifyListeners(): void {
  _listeners.forEach((listener) => {
    try {
      listener(_state);
    } catch {
      // Ignore listener errors
    }
  });
}
