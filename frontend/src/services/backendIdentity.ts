/**
 * backendIdentity.ts — Lightweight backend-identity readiness tracker.
 *
 * Problem: After Firebase auth restoration, the Dashboard renders immediately
 * and fires API requests. But the Patient row in PostgreSQL is created by
 * POST /api/v1/auth/sync. If API requests arrive before that sync completes,
 * get_authenticated_patient_id returns 403.
 *
 * Solution: AuthContext stores the sync promise here. The Axios request
 * interceptor awaits it (with a bounded timeout) before attaching the token.
 * This coordinates API requests with identity readiness without blocking
 * the Dashboard UI.
 *
 * Recovery: If a sync fails or times out, a subsequent auth state change
 * (e.g. token refresh) starts a new sync. The new promise is tracked
 * independently — pending requests will wait for it.
 *
 * Flow:
 *   1. AuthContext fires syncBackendIdentity() on mount
 *   2. Stores the promise via setSyncPromise()
 *   3. Dashboard renders immediately (setLoading(false) not blocked)
 *   4. First API request hits the interceptor
 *   5. Interceptor awaits waitForIdentityReady() (max 3s)
 *   6. Sync completes → Patient row exists → request succeeds
 *   7. If sync times out → request proceeds → may get 403 → normal error handling
 *   8. Later auth state change → new sync → new promise → recovery
 */

/** The most recent sync promise. null means no sync has started yet. */
let _syncPromise: Promise<void> | null = null;

/**
 * Whether the MOST RECENT sync has settled (resolved or rejected).
 * Reset to false each time a new sync starts via setSyncPromise().
 * This ensures a new sync after a previous failure is always waited on.
 */
let _syncResolved = false;

/** Maximum time an API request will wait for the sync to complete. */
const IDENTITY_SYNC_TIMEOUT_MS = 3000;

/**
 * Called by AuthContext when the backend identity sync starts.
 * Stores the promise so the API interceptor can await it.
 *
 * Each call represents a new sync attempt. If a previous sync had
 * resolved (success or failure), _syncResolved is reset so that
 * pending/new requests wait for this fresh attempt.
 */
export function setSyncPromise(promise: Promise<void>): void {
  // Reset resolved flag — a new sync is starting.
  // Any request that calls waitForIdentityReady() after this point
  // will wait for this new promise, not skip based on a stale resolution.
  _syncResolved = false;

  // Wrap the promise to track settlement.
  // .then handler runs on both resolve and reject (via the second arg),
  // so _syncResolved is always set when the sync finishes.
  _syncPromise = promise.then(
    () => { _syncResolved = true; },
    () => { _syncResolved = true; },
  );
}

/**
 * Wait for the backend identity sync to complete.
 * Returns quickly if sync is already done, or after IDENTITY_SYNC_TIMEOUT_MS.
 * Never blocks indefinitely.
 */
export async function waitForIdentityReady(): Promise<void> {
  // Fast path 1: sync already resolved (success or failure) — zero delay
  if (_syncResolved) return;

  // Fast path 2: no sync has started yet — zero delay
  // (Dashboard renders before sync starts; first requests may take this path.
  //  They'll get a 403 if the Patient row doesn't exist, which is handled
  //  by normal React Query error/retry.)
  if (!_syncPromise) return;

  // Slow path: sync is in progress — wait up to 3s
  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, IDENTITY_SYNC_TIMEOUT_MS),
  );

  await Promise.race([_syncPromise, timeout]);
}
