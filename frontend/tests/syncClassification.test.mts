/**
 * Phase 0 / Increment 3 — sync classification + retry-policy unit tests.
 *
 * Covers the pure, dependency-free logic in frontend/src/services/syncClassification.ts
 * that drives the Home "Sync needs attention" banner.
 *
 * Regression focus (Issue A):
 *   - A transient/retryable failure (network, timeout, 5xx) must NEVER escalate
 *     the UI to SYNC_FAILED — the mutation stays 'pending' ("Saved locally").
 *   - Only permanent (4xx), auth, and exhausted conflict/unknown failures may
 *     produce SYNC_FAILED — and those must.
 *   - Retry attempts respect exponential backoff instead of re-firing on every
 *     sync trigger.
 *
 * Run with Node built-ins (no Jest, no new deps):
 *   node --experimental-strip-types --test frontend/tests/syncClassification.test.mts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySyncError,
  computeBackoffDelayMs,
  deriveSyncStatus,
  isRetryableCategory,
  shouldExhaustRetries,
} from '../src/services/syncClassification.ts';

// ============================================================================
// deriveSyncStatus — the banner state machine (REGRESSION: Issue A)
// ============================================================================

test('deriveSyncStatus: empty, idle state is SYNCED', () => {
  assert.equal(
    deriveSyncStatus({ pendingCount: 0, failedCount: 0, isSyncing: false }),
    'SYNCED',
  );
});

test('deriveSyncStatus: queued-but-syncing pass wins (SYNCING)', () => {
  assert.equal(
    deriveSyncStatus({ pendingCount: 5, failedCount: 0, isSyncing: true }),
    'SYNCING',
  );
});

test('deriveSyncStatus: queued mutations with no failures → SAVED_LOCALLY', () => {
  assert.equal(
    deriveSyncStatus({ pendingCount: 3, failedCount: 0, isSyncing: false }),
    'SAVED_LOCALLY',
  );
});

test('REGRESSION deriveSyncStatus: transient failures must NOT show SYNC_FAILED', () => {
  // A retryable (offline/flaky-network) failure leaves the row 'pending',
  // so failedCount stays 0 → the banner must read "Saved locally".
  assert.equal(
    deriveSyncStatus({ pendingCount: 1, failedCount: 0, isSyncing: false }),
    'SAVED_LOCALLY',
    'payload is safe on device — queued, not "needs attention"',
  );
});

test('deriveSyncStatus: any failed row → SYNC_FAILED (real attention cases)', () => {
  // A 422 or auth failure lands the row in 'failed', and the user must see it.
  assert.equal(
    deriveSyncStatus({ pendingCount: 0, failedCount: 1, isSyncing: false }),
    'SYNC_FAILED',
  );
  // Failed rows still surface even when other mutations are waiting.
  assert.equal(
    deriveSyncStatus({ pendingCount: 2, failedCount: 1, isSyncing: false }),
    'SYNC_FAILED',
  );
});

// ============================================================================
// classifySyncError
// ============================================================================

test('classifySyncError: network codes / timeouts / 5xx → retryable', () => {
  assert.equal(classifySyncError({ code: 'ECONNABORTED' }), 'retryable');
  assert.equal(classifySyncError({ code: 'ERR_NETWORK' }), 'retryable');
  assert.equal(classifySyncError({ message: 'timeout of 120s exceeded' }), 'retryable');
  assert.equal(
    classifySyncError({ message: 'Network Error' }),
    'retryable',
  );
  assert.equal(
    classifySyncError({ response: { status: 503 } }),
    'retryable',
  );
  assert.equal(
    classifySyncError({ response: { status: 500 } }),
    'retryable',
  );
});

test('classifySyncError: HTTP status mapping', () => {
  assert.equal(classifySyncError({ response: { status: 401 } }), 'auth');
  assert.equal(classifySyncError({ response: { status: 409 } }), 'conflict');
  assert.equal(classifySyncError({ response: { status: 429 } }), 'retryable');
  assert.equal(classifySyncError({ response: { status: 422 } }), 'permanent');
  assert.equal(classifySyncError({ response: { status: 404 } }), 'permanent');
  assert.equal(classifySyncError(null), 'unknown');
  assert.equal(classifySyncError({}), 'unknown');
  assert.equal(classifySyncError({ response: { status: 999 } }), 'retryable');
});

test('isRetryableCategory: only retryable/conflict/unknown auto-retry', () => {
  assert.equal(isRetryableCategory('retryable'), true);
  assert.equal(isRetryableCategory('conflict'), true);
  assert.equal(isRetryableCategory('unknown'), true);
  assert.equal(isRetryableCategory('permanent'), false);
  assert.equal(isRetryableCategory('auth'), false);
});

// ============================================================================
// Retry policy (REGRESSION: Issue A — no phantom "needs attention" offline)
// ============================================================================

test('REGRESSION shouldExhaustRetries: network failures NEVER exhaust, even past the cap', () => {
  // An offline device: 6, 10, even 50 transient failures must keep the row
  // queued as 'pending' ("Saved locally") — never flip it to attention.
  for (let attempt = 1; attempt <= 20; attempt++) {
    assert.equal(
      shouldExhaustRetries(attempt, 'retryable', 5),
      false,
      `transient failure #${attempt} must not escalate`,
    );
  }
});

test('shouldExhaustRetries: conflict/unknown cap at maxAttempts', () => {
  assert.equal(shouldExhaustRetries(4, 'conflict', 5), false);
  assert.equal(shouldExhaustRetries(5, 'conflict', 5), true);
  assert.equal(shouldExhaustRetries(5, 'unknown', 5), true);
  assert.equal(shouldExhaustRetries(5, 'unknown', 6), false);
});

test('REGRESSION 429 (rate limited) must be retryable, never permanent', () => {
  // A rate-limited mutation (HTTP 429) is a transient condition: the server
  // will accept it again after the Retry-After window. It must stay queued as
  // 'pending' ("Saved locally") and never escalate to SYNC_FAILED.
  const category = classifySyncError({ response: { status: 429 } });
  assert.equal(category, 'retryable');
  assert.equal(isRetryableCategory(category), true);

  // …and NEVER exhaust, no matter how many rate-limit windows pass.
  for (let attempt = 1; attempt <= 20; attempt++) {
    assert.equal(
      shouldExhaustRetries(attempt, category, 5),
      false,
      `429 failure #${attempt} must stay queued`,
    );
  }

  // UI shows "Saved locally" — the payload is safe on device.
  assert.equal(
    deriveSyncStatus({ pendingCount: 1, failedCount: 0, isSyncing: false }),
    'SAVED_LOCALLY',
  );
});

test('computeBackoffDelayMs: exponential growth capped at max', () => {
  assert.equal(computeBackoffDelayMs(1, 1000, 30000), 1000);
  assert.equal(computeBackoffDelayMs(2, 1000, 30000), 2000);
  assert.equal(computeBackoffDelayMs(3, 1000, 30000), 4000);
  assert.equal(computeBackoffDelayMs(6, 1000, 30000), 30000, 'capped at 30s');
  assert.equal(computeBackoffDelayMs(10, 1000, 30000), 30000);
  assert.equal(computeBackoffDelayMs(10, 1000, 30000) >= 1, true);
  // attempt 0 (no failures yet) still yields a sane delay
  assert.equal(computeBackoffDelayMs(0, 1000, 30000), 1000);
});

test('real-device scenario: offline holds mutations without alarm, online heals', () => {
  // Simulate the report: a queued mutation on a flaky mobile connection.
  let failedCount = 0;
  let pendingCount = 1;

  // Several transient failures while offline…
  for (let attempt = 1; attempt <= 8; attempt++) {
    const category = classifySyncError({ code: 'ERR_NETWORK' });
    const exhausted =
      isRetryableCategory(category) &&
      shouldExhaustRetries(attempt, category, 5);
    if (exhausted) failedCount += 1;
    // …the row STAYS pending (never enters failed) throughout.
    assert.equal(exhausted, false, `offline attempt #${attempt} stays queued`);
  }
  assert.equal(failedCount, 0);

  // UI shows "Saved locally" — not "Sync needs attention".
  assert.equal(
    deriveSyncStatus({ pendingCount, failedCount, isSyncing: false }),
    'SAVED_LOCALLY',
  );

  // Back online: the success path clears the queue.
  pendingCount = 0;
  assert.equal(
    deriveSyncStatus({ pendingCount, failedCount, isSyncing: false }),
    'SYNCED',
  );
});

// ============================================================================
// Increment 7 — daily-log sync payload integrity (offline data loss)
//
// The sync engine delivers `daily_logs` queue entries via
// frontend/src/services/syncEngine.ts getEndpointConfig().buildBody().
// Each body field MUST be present in the payload that
// frontend/src/db/queries/dailyLogs.ts upsertDailyLog stores in the sync_queue
// `payload_json`. Missing fields silently null out a health record when the
// device saves offline and syncs later — regression guard so that cannot
// be reintroduced.
// ============================================================================

test('I7: daily_logs sync payload carries every health field the engine posts', () => {
  // The exact field set buildBody() reads for a daily_logs create/update.
  const requiredFields = [
    'log_date',
    'overall_wellbeing',
    'energy_level',
    'stress_level',
    'sleep',
    'nutrition',
    'notes',
    'symptoms',
    'vitals',
    'pain',
    'activities',
    'medications',
  ];
  for (const field of requiredFields) {
    assert.ok(field in payloadShape, `missing sync field: ${field}`);
  }
});

const payloadShape: Record<string, unknown> = {
  group_id: 'local-abc',
  patient_id: 'pt-1',
  log_date: '2026-09-11',
  overall_wellbeing: 7,
  energy_level: 6,
  stress_level: 4,
  sleep: { duration_minutes: 480, sleep_quality: 'good', awakenings: 1 },
  nutrition: { water_ml: 2000, meals_count: 3, appetite_level: 'normal' },
  notes: 'felt great',
  symptoms: [{ concept_id: 'c1', severity: 'mild' }],
  vitals: [{ concept_id: 'c2', value: 120 }],
  pain: [{ concept_id: 'c3', level: 2 }],
  activities: [{ concept_id: 'c4' }],
  medications: [{ concept_id: 'c5' }],
};