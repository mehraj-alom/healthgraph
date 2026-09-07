/**
 * Hook for sync status display.
 *
 * Provides reactive sync status for UI components.
 * Subscribes to syncState changes and re-renders on updates.
 */

import { useState, useEffect } from 'react';
import {
  getSyncDisplayState,
  subscribeSyncState,
  retrySync,
  type SyncDisplayState,
  type SyncStatus,
} from '@/services/syncState';

export type { SyncStatus };

export interface UseSyncStatusResult {
  status: SyncStatus;
  pendingCount: number;
  lastSyncSuccess: number | null;
  lastErrorCategory: string | null;
  retry: () => Promise<void>;
}

/**
 * Get user-facing message for sync status.
 */
export function getSyncStatusMessage(status: SyncStatus): string {
  switch (status) {
    case 'SYNCED':
      return 'Synced';
    case 'SYNCING':
      return 'Syncing…';
    case 'SAVED_LOCALLY':
      return 'Saved locally';
    case 'SYNC_FAILED':
      return 'Sync needs attention';
    default:
      return '';
  }
}

/**
 * Hook that provides reactive sync status.
 */
export function useSyncStatus(): UseSyncStatusResult {
  const [state, setState] = useState<SyncDisplayState>(getSyncDisplayState());

  useEffect(() => {
    const unsubscribe = subscribeSyncState(setState);
    return unsubscribe;
  }, []);

  return {
    ...state,
    retry: retrySync,
  };
}
