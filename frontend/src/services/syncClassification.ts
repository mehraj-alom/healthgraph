/**
 * syncClassification.ts — Pure, dependency-free sync classification + backoff.
 *
 * Increment 3: extracted from syncEngine.ts so the decision logic driving the
 * "Sync needs attention" banner can be unit-tested in Node (zero runtime
 * imports — only a type-only import that is erased under strip-types).
 *
 * Core rule this module enforces (offline-first, Issue A):
 *   - Transient/retryable failures (network, timeout, 5xx) NEVER escalate to
 *     "needs attention". The mutation stays queued ('pending') and is retried
 *     with capped exponential backoff. The data is safe on device.
 *   - Only genuine permanent failures (4xx except 401/409/429), auth
 *     failures, and exhausted conflict/unknown failures become "failed" →
 *     SYNC_FAILED. 429 (rate limited) is transient: the mutation stays
 *     queued and is retried after the rate-limit window.
 */

import type { SyncErrorCategory } from './syncTypes';

/**
 * User-facing sync status (distinct from the queue-row SyncStatus in
 * syncTypes.ts). Kept in this pure module so deriveSyncStatus is testable
 * without importing syncState/syncEngine (which pull in axios/firebase).
 */
export type SyncDisplayStatus =
  | 'SYNCED'
  | 'SYNCING'
  | 'SAVED_LOCALLY'
  | 'SYNC_FAILED';

// ============================================================================
// Error classification
// ============================================================================

/**
 * Classify a sync error into a category.
 * Mirrors the original syncEngine.classifyError logic (kept identical so
 * behaviour is preserved while becoming testable).
 */
export function classifySyncError(error: unknown): SyncErrorCategory {
  const err = error as {
    code?: string;
    message?: string;
    response?: { status?: number };
  } | null;

  // Network errors
  if (err?.code === 'ECONNABORTED' || err?.code === 'ERR_NETWORK') {
    return 'retryable';
  }
  if (err?.message?.includes('timeout')) {
    return 'retryable';
  }
  if (err?.message?.includes('Network Error')) {
    return 'retryable';
  }

  // HTTP status codes
  const status = err?.response?.status;
  if (status === undefined || status === null) {
    return 'unknown';
  }

  // 4xx client errors (except 401, 409, and 429)
  if (status >= 400 && status < 500) {
    if (status === 401) return 'auth';
    if (status === 409) return 'conflict';
    // 429 (rate limited) is transient: the request stays queued and is
    // retried after the server's Retry-After/backoff window.
    if (status === 429) return 'retryable';
    return 'permanent';
  }

  // 5xx server errors
  if (status >= 500) {
    return 'retryable';
  }

  return 'unknown';
}

/**
 * Categories that should be retried automatically (kept queued as 'pending'):
 * network/timeout/5xx (retryable), plus conflict (409 — usually resolved by
 * the backend idempotency key) and unknown. Only these three are subject to
 * eventual exhaustion via shouldExhaustRetries.
 */
export function isRetryableCategory(category: SyncErrorCategory): boolean {
  return (
    category === 'retryable' ||
    category === 'conflict' ||
    category === 'unknown'
  );
}

// ============================================================================
// Retry policy
// ============================================================================

/**
 * Decide whether a retryable failure should be exhausted (flipped to 'failed',
 * i.e. "needs attention") after this many attempts.
 *
 * Network-class failures ('retryable') are deliberately NEVER exhausted:
 * a device that is offline — or behind a flaky connection — must be able to
 * keep a mutation queued indefinitely as 'pending' ("Saved locally") without
 * the app claiming it needs attention. Conflict/unknown failures cap at
 * maxAttempts so a genuinely stuck payload eventually surfaces.
 */
export function shouldExhaustRetries(
  attemptCount: number,
  category: SyncErrorCategory,
  maxAttempts: number,
): boolean {
  if (category === 'retryable') return false;
  return attemptCount >= maxAttempts;
}

/**
 * Exponential backoff for the next automatic attempt.
 * attemptCount is the number of attempts already made (1 for the first
 * failure). Growth: base * 2^(attemptCount-1), capped at max. Always >= 1.
 */
export function computeBackoffDelayMs(
  attemptCount: number,
  baseMs = 1000,
  maxMs = 30000,
): number {
  if (attemptCount <= 0) return baseMs;
  const delay = baseMs * Math.pow(2, attemptCount - 1);
  return Math.max(1, Math.min(maxMs, delay));
}

// ============================================================================
// UI state derivation
// ============================================================================

/**
 * Derive the user-facing sync status from queue counts.
 *
 * Priority (matches original refreshSyncState):
 *   1. SYNCING   — a sync pass is actively running
 *   2. SYNC_FAILED — there are items that genuinely need attention
 *      (a row in 'failed' status, which now ONLY permanent/auth/exhausted
 *      failures reach — transient failures stay 'pending')
 *   3. SAVED_LOCALLY — mutations queued, not yet synced (safe on device)
 *   4. SYNCED — nothing pending and nothing failed
 */
export function deriveSyncStatus(counts: {
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
}): SyncDisplayStatus {
  if (counts.isSyncing) return 'SYNCING';
  if (counts.failedCount > 0) return 'SYNC_FAILED';
  if (counts.pendingCount > 0) return 'SAVED_LOCALLY';
  return 'SYNCED';
}