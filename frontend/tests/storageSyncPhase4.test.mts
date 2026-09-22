/**
 * storageSyncPhase4 — behavioral tests for local-first storage hardening.
 *
 * Runs against real in-memory SQLite (node:sqlite, same facade pattern as
 * migrations.test.mts) plus the real pure decision modules:
 *   - migration 11: fresh migrate → patient_id column + index exist, rows
 *     preserved, legacy NULL owner allowed, idempotent re-run
 *   - queue ownership: stamped/payload/legacy matrix through the REAL
 *     shouldSyncQueueItem + queueItemPatientId (one user's rows never sync
 *     under another user's session)
 *   - dequeue prefilter semantics: owned + legacy-prefiltered, backstop
 *     applied per row (mirrors syncEngine.getPendingMutations two-layer
 *     design; the backstop itself is production code)
 *   - taken-slot matching: same-minute pair resolves to the scheduled dose
 *   - refresh subscription lifecycle: subscribe/unsubscribe/double-remove
 * plus wiring guards (text-level, exactly like rppgFlow.test.mts) for the
 * RN/native-bound layers that node cannot execute: atomic row+queue writes,
 * engine scoping, hydration gating, taken flush, retry-continue, RQ clearing.
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/storageSyncPhase4.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CURRENT_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from '../src/db/migrations.ts';
import {
  queueItemPatientId,
  shouldSyncQueueItem,
} from '../src/services/syncClassification.ts';
import {
  groupTakenByMinute,
  matchTakenToSlot,
  timeOfDay,
} from '../src/utils/medicationSchedule.ts';
import {
  consumeDataRefreshRequest,
  requestDataRefresh,
  subscribeDataRefresh,
} from '../src/services/dataRefresh.ts';

declare const __dirname: string;

function repoRoot(): string {
  const bases: string[] = [];
  try {
    if (typeof __dirname === 'string') bases.push(path.resolve(__dirname, '..'));
  } catch {
    // ESM/strip-types runtimes have no __dirname: fall through to cwd.
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'frontend'));
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, 'App.tsx'))) return b;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('repo root not found (App.tsx missing)');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Minimal async facade over node:sqlite matching the expo-sqlite subset used
// by migrations (same shape as migrations.test.mts makeDb).
function makeDb() {
  const s = new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys = ON');
  const flat = (params: unknown[]) =>
    params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return {
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const stmt = s.prepare(sql);
      const r = stmt.run(...(flat(params) as unknown[]));
      return { changes: Number(r.changes), lastInsertRowId: 0 };
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const r = s.prepare(sql).get(...(flat(params) as unknown[])) as T | undefined;
      return r ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...(flat(params) as unknown[])) as T[];
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      s.exec('BEGIN');
      try {
        await fn();
        s.exec('COMMIT');
      } catch (e) {
        try {
          s.exec('ROLLBACK');
        } catch {
          // Already rolled back.
        }
        throw e;
      }
    },
  };
}

// ============================================================================
// Migration 11 — real migration chain on real SQLite
// ============================================================================

describe('migration 11 queue ownership', () => {
  test('fresh database reaches CURRENT with the patient column + index', async () => {
    const db = makeDb();
    const version = await runMigrations(db as never);
    assert.equal(version, CURRENT_SCHEMA_VERSION);
    assert.equal(await getSchemaVersion(db as never), CURRENT_SCHEMA_VERSION);
    const cols = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM pragma_table_info('sync_queue')",
    );
    assert.ok(cols.some((c) => c.name === 'patient_id'));
    const idx = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'ix_sync_patient'",
    );
    assert.equal(idx.length, 1);
  });

  test('legacy rows survive with NULL owner; new rows stamp fine', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    await db.runAsync(
      `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json) VALUES ('medications','r1','m1','create','{"patient_id":"pat-A"}')`,
    );
    const legacy = await db.getFirstAsync<{ patient_id: string | null }>(
      'SELECT patient_id FROM sync_queue WHERE record_id = ?',
      'r1',
    );
    assert.equal(legacy?.patient_id, null);
    await db.runAsync(
      `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json, patient_id) VALUES ('medications','r2','m2','create','{}','pat-A')`,
    );
    const stamped = await db.getFirstAsync<{ patient_id: string | null }>(
      'SELECT patient_id FROM sync_queue WHERE record_id = ?',
      'r2',
    );
    assert.equal(stamped?.patient_id, 'pat-A');
  });

  test('re-run is idempotent (version stable, no duplicate log rows)', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    await runMigrations(db as never);
    assert.equal(await getSchemaVersion(db as never), CURRENT_SCHEMA_VERSION);
    const logs = await db.getAllAsync<{ version: number }>(
      'SELECT version FROM _migration_log WHERE version = 11',
    );
    assert.equal(logs.length, 1);
  });
});

// ============================================================================
// Queue ownership decisions — real pure module
// ============================================================================

describe('shouldSyncQueueItem', () => {
  test('stamped owner match syncs; mismatch never syncs', () => {
    assert.equal(shouldSyncQueueItem({ patient_id: 'pat-A', payload_json: '{}' }, 'pat-A'), true);
    assert.equal(shouldSyncQueueItem({ patient_id: 'pat-A', payload_json: '{}' }, 'pat-B'), false);
  });

  test('legacy rows resolve via payload backstop', () => {
    assert.equal(
      shouldSyncQueueItem({ patient_id: null, payload_json: '{"patient_id":"pat-A"}' }, 'pat-A'),
      true,
    );
    assert.equal(
      shouldSyncQueueItem({ patient_id: null, payload_json: '{"patient_id":"pat-A"}' }, 'pat-B'),
      false,
    );
  });

  test('unknown owner fails closed (never synced blindly)', () => {
    assert.equal(shouldSyncQueueItem({ patient_id: null, payload_json: null }, 'pat-A'), false);
    assert.equal(shouldSyncQueueItem({ patient_id: null, payload_json: '{}' }, 'pat-A'), false);
    assert.equal(shouldSyncQueueItem({ patient_id: null, payload_json: 'not-json' }, 'pat-A'), false);
    assert.equal(shouldSyncQueueItem({ patient_id: '', payload_json: '' }, 'pat-A'), false);
  });

  test('empty session patient never syncs anything', () => {
    assert.equal(shouldSyncQueueItem({ patient_id: 'pat-A', payload_json: '{}' }, ''), false);
  });

  test('queueItemPatientId prefers the stamped column', () => {
    assert.equal(
      queueItemPatientId({ patient_id: 'pat-A', payload_json: '{"patient_id":"pat-B"}' }),
      'pat-A',
    );
  });
});

describe('dequeue isolation semantics', () => {
  // Mirrors the syncEngine.getPendingMutations two-layer design: SQL
  // prefilter (owned + legacy) then the production backstop per row.
  async function syncableFor(patientId: string): Promise<string[]> {
    const db = makeDb();
    await runMigrations(db as never);
    await db.runAsync(`INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json, patient_id, status) VALUES
      ('medications','own-a','m1','create','{}','pat-A','pending'),
      ('medications','own-b','m2','create','{}','pat-B','pending'),
      ('medications','leg-a','m3','create','{"patient_id":"pat-A"}',NULL,'pending'),
      ('medications','leg-b','m4','create','{"patient_id":"pat-B"}',NULL,'pending'),
      ('medications','leg-unknown','m5','create','{}',NULL,'pending'),
      ('medications','done-a','m6','create','{}','pat-A','completed')`);
    const prefiltered = await db.getAllAsync<{ record_id: string; patient_id: string | null; payload_json: string | null }>(
      `SELECT record_id, patient_id, payload_json FROM sync_queue
       WHERE status = 'pending' AND table_name != '_hydration'
         AND (patient_id = ? OR patient_id IS NULL)
       ORDER BY record_id ASC`,
      patientId,
    );
    return prefiltered
      .filter((row) => shouldSyncQueueItem(row, patientId))
      .map((row) => row.record_id);
  }

  test('pat-A sees only its own + attributed legacy rows', async () => {
    assert.deepEqual(await syncableFor('pat-A'), ['leg-a', 'own-a']);
  });

  test('pat-B sees only its own + attributed legacy rows', async () => {
    assert.deepEqual(await syncableFor('pat-B'), ['leg-b', 'own-b']);
  });
});

// ============================================================================
// Taken-slot matching — same-minute doses stay visible
// ============================================================================

describe('taken-slot matching', () => {
  test('timeOfDay uses local HH:MM, null on garbage', () => {
    assert.match(timeOfDay('2026-09-12T08:05:00.000Z') ?? '', /^\d{2}:\d{2}$/);
    assert.equal(timeOfDay('garbage'), null);
  });

  test('scheduled dose wins its slot over an unscheduled same-minute dose', () => {
    const groups = groupTakenByMinute([
      { event_id: 'extra', taken_at: '2026-09-12T08:00:10', scheduled_for: null },
      { event_id: 'dose', taken_at: '2026-09-12T08:00:40', scheduled_for: '2026-09-12T08:00:00' },
    ]);
    const keys = [...groups.keys()];
    assert.equal(keys.length, 1);
    const pick = matchTakenToSlot(groups.get(keys[0]) ?? [], keys[0]);
    assert.equal(pick?.event_id, 'dose');
  });

  test('single event matches; empty bucket shows untaken (null)', () => {
    const groups = groupTakenByMinute([
      { event_id: 'only', taken_at: '2026-09-12T20:00:00', scheduled_for: null },
    ]);
    const keys = [...groups.keys()];
    assert.equal(matchTakenToSlot(groups.get(keys[0]) ?? [], keys[0])?.event_id, 'only');
    assert.equal(matchTakenToSlot([], '08:00'), null);
  });

  test('unparseable timestamps are skipped, never crash matching', () => {
    const groups = groupTakenByMinute([
      { event_id: 'bad', taken_at: 'garbage', scheduled_for: null },
      { event_id: 'good', taken_at: '2026-09-12T08:00:00', scheduled_for: null },
    ]);
    assert.equal(groups.size, 1);
  });
});

// ============================================================================
// Refresh subscription lifecycle — real pub/sub module
// ============================================================================

describe('refresh subscription lifecycle', () => {
  test('unsubscribe detaches; double-remove is safe; bursts notify each time', () => {
    let a = 0;
    let b = 0;
    const unsubA = subscribeDataRefresh(() => {
      a += 1;
    });
    const unsubB = subscribeDataRefresh(() => {
      b += 1;
    });
    requestDataRefresh();
    requestDataRefresh();
    assert.equal(a, 2);
    assert.equal(b, 2);
    unsubA();
    unsubA();
    requestDataRefresh();
    assert.equal(a, 2);
    assert.equal(b, 3);
    unsubB();
    consumeDataRefreshRequest();
  });
});

// ============================================================================
// Wiring guards — RN/native-bound layers (text-level, repo precedent)
// ============================================================================

describe('phase 4 wiring', () => {
  test('medication writes are atomic: row + queue share one transaction', () => {
    for (const rel of [
      'src/db/queries/medications.ts',
      'src/db/queries/medicationTakenEvents.ts',
      'src/db/queries/dailyLogs.ts',
    ]) {
      const s = src(rel);
      // New split: SQL inside the txn, side effects announced after commit.
      assert.ok(s.includes('writeQueueRow(db, patientId'), rel);
      assert.ok(s.includes('announceQueueWrite()'), rel);
      // Old helper (row and queue in separate statements) must be gone.
      assert.ok(!s.includes('addToSyncQueue('), rel);
    }
  });

  test('engine dequeues, retries, and counts per patient with backstop', () => {
    const engine = src('src/services/syncEngine.ts');
    assert.ok(engine.includes('shouldSyncQueueItem'), 'backstop import');
    assert.ok(engine.includes('(patient_id = ? OR patient_id IS NULL)'), 'dequeue/retry filter');
    assert.ok(engine.includes('shouldSyncQueueItem(item, ownerId)'), 'backstop applied');
    assert.ok(engine.includes('if (!patientId) return [];'), 'logged-out dequeue guard');
    assert.ok(engine.includes('if (!patientId) return 0;'), 'logged-out retry guard');
  });

  test('logout clears the entire React Query cache and cancels flight', () => {
    const app = src('App.tsx');
    assert.ok(app.includes('queryClient.cancelQueries()'), 'cancel in-flight');
    assert.ok(app.includes('queryClient.clear()'), 'clear all keys');
    assert.ok(!app.includes('removeQueries'), 'subset clear removed');
  });

  test('taken hydration marks only on success; offline flush exists', () => {
    const hook = src('src/hooks/useMedications.ts');
    assert.ok(hook.includes('let hydratedOk = false;'), 'success tracking');
    assert.ok(hook.includes('if (hydratedOk)'), 'gated marking');
    assert.ok(hook.includes('syncPendingTakenEvents(patientId)'), 'flush wired');
    assert.ok(hook.includes('takenFlushInFlight'), 'flush mutual exclusion');
    assert.ok(hook.includes('TAKEN_FLUSH_FRESH_MS'), 'freshness grace');
  });

  test('pending-taken query is patient-scoped with freshness cutoff', () => {
    const q = src('src/db/queries/medicationTakenEvents.ts');
    assert.ok(q.includes("AND sync_status = 'pending_create'"), 'pending only');
    assert.ok(q.includes('taken_at < ?'), 'cutoff param');
    assert.ok(q.includes('matchTakenToSlot'), 'F4 matcher wired');
  });

  test('ppg/rppg retry continues past single failures', () => {
    for (const rel of ['src/services/ppgService.ts', 'src/services/rppgService.ts']) {
      const s = src(rel);
      assert.ok(s.includes('continue;'), rel);
      assert.ok(!s.includes('break; // stop on first failure'), rel);
    }
  });
});
