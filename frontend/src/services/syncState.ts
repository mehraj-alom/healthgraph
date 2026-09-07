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

import { getSyncState } from './syncEngine';

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
 */
export async function refreshSyncState(): Promise<void> {
  try {
    const dbState = await getSyncState();

    let status: SyncStatus = 'SYNCED';

    if (dbState.isSyncing) {
      status = 'SYNCING';
    } else if (dbState.failedCount > 0) {
      status = 'SYNC_FAILED';
    } else if (dbState.pendingCount > 0) {
      status = 'SAVED_LOCALLY';
    }

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
 * Mark sync as completed successfully.
 */
export function markSynced(): void {
  _state = {
    status: 'SYNCED',
    pendingCount: 0,
    lastSyncSuccess: Date.now(),
    lastErrorCategory: null,
  };
  _notifyListeners();
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
 * Mark sync as failed with error category.
 */
export function markSyncFailed(errorCategory: string): void {
  _state = {
    ..._state,
    status: 'SYNC_FAILED',
    lastErrorCategory: errorCategory,
  };
  _notifyListeners();
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
 * Verifies authentication and network before retrying.
 */
export async function retrySync(): Promise<void> {
  const { getCachedPatientId } = await import('./patientIdentity');
  const { isOnline } = await import('./networkMonitor');
  const { syncPendingMutations } = await import('./syncEngine');

  // Verify authentication
  if (!getCachedPatientId()) {
    return;
  }

  // Verify network
  if (!isOnline()) {
    return;
  }

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
