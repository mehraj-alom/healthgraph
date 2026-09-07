/**
 * Sync engine types.
 *
 * Defines the data structures for the offline mutation queue
 * and synchronization operations.
 */

// ============================================================================
// Queue Item
// ============================================================================

export type SyncOperation = 'create' | 'update' | 'delete';
export type SyncStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type SyncTableName =
  | 'medications'
  | 'medication_taken_events'
  | 'daily_logs'
  | 'daily_log_events'
  | '_hydration';

export interface SyncQueueItem {
  id: number;
  table_name: SyncTableName;
  record_id: string;
  mutation_id: string;
  operation: SyncOperation;
  payload_json: string | null;
  created_at: string;
  attempt_count: number;
  last_error: string | null;
  status: SyncStatus;
}

// ============================================================================
// Sync Result
// ============================================================================

export type SyncErrorCategory =
  | 'retryable'
  | 'permanent'
  | 'conflict'
  | 'auth'
  | 'unknown';

export interface SyncResult {
  success: boolean;
  queueItemId: number;
  tableName: string;
  operation: string;
  recordId: string;
  error?: string;
  errorCategory?: SyncErrorCategory;
  serverId?: string;
}

// ============================================================================
// Sync State
// ============================================================================

export interface SyncState {
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  lastSyncAttempt: number | null;
  lastSyncSuccess: number | null;
  isSyncing: boolean;
}

// ============================================================================
// API Mappings
// ============================================================================

export interface SyncEndpointConfig {
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
  /** Extract server ID from response */
  extractServerId?: (response: any) => string | null;
  /** Build request body from payload */
  buildBody?: (payload: any) => any;
}
