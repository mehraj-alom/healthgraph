/**
 * Phase 0 / Increment 1 — frontend SQLite migration + schema-contract tests.
 *
 * Runs the REAL migration module (frontend/src/db/migrations.ts) against a
 * real in-memory SQLite database using the Node built-in test runner and the
 * experimental `node:sqlite` module — zero new npm dependencies.
 *
 * migrations.ts only has a type-only import, so it is fully erasable under
 * `--experimental-strip-types` and never touches expo-sqlite at runtime.
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/migrations.test.mts
 *
 * The expo-sqlite-facing SQL in this file mirrors the production query modules
 * (queries/documents.ts, queries/homeCache.ts, services/syncEngine.ts) so the
 * contracts they rely on are regression-guarded without importing native code.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  CURRENT_SCHEMA_VERSION,
  getMissingTables,
  getSchemaVersion,
  runMigrations,
  setSchemaVersion,
  verifySchemaVersion,
} from '../src/db/migrations.ts';

/**
 * Minimal async facade over node:sqlite matching the subset of the
 * expo-sqlite API used by the migrations and by the mirrored queries.
 */
export function makeDb() {
  const s = new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys = ON');

  const flat = (params: unknown[]) =>
    params.length === 1 && Array.isArray(params[0]) ? params[0] : params;

  return {
    _s: s,
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const stmt = s.prepare(sql);
      const r = stmt.run(...(flat(params) as unknown[]));
      return {
        changes: Number(r.changes),
        lastInsertRowId: Number(r.lastInsertRowId ?? 0),
      };
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
        s.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

async function tableNames(db: any): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  return rows.map((r) => r.name);
}

// Tables/columns here come from internal constants, so interpolating the table
// name is safe (node:sqlite does not bind parameters inside PRAGMA statements).
async function columnNames(db: any, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string; notnull: number }>(
    `SELECT name, "notnull" FROM pragma_table_info('${table}')`,
  );
  return rows.map((r) => r.name);
}

async function notNullColumns(db: any, table: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string; notnull: number }>(
    `SELECT name, "notnull" FROM pragma_table_info('${table}')`,
  );
  return new Set(rows.filter((r) => r.notnull > 0).map((r) => r.name));
}

// ============================================================================
// SQL mirrors of production query modules (see headers in the source files)
// ============================================================================

// documents.ts -> upsertDocument()
const UPSERT_DOCUMENT = `
  INSERT INTO documents (
    document_id, patient_id, file_hash, storage_url,
    status, created_at, updated_at, cached_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET
    patient_id = excluded.patient_id,
    file_hash = excluded.file_hash,
    storage_url = excluded.storage_url,
    status = excluded.status,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    cached_at = datetime('now')
`;

// homeCache.ts -> setDailyMetricsCache() / getDailyMetricsCache()
const UPSERT_DAILY_METRICS = `
  INSERT INTO daily_metrics_cache (patient_id, metrics_json, cached_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(patient_id) DO UPDATE SET
    metrics_json = excluded.metrics_json,
    cached_at = datetime('now')
`;

// syncEngine.ts -> cleanupCompletedItems()
const CLEANUP_COMPLETED = `
  DELETE FROM sync_queue
  WHERE status = 'completed'
    AND created_at < datetime('now', '-1 day')
`;

// syncEngine.ts -> recoverStaleProcessing() (5-minute threshold).
// Increment 2: production was fixed from `datetime('now', '-', ? || ' seconds')`
// (invalid standalone '-' modifier => NULL, stale items never recovered) to
// `datetime('now', '-' || ? || ' seconds')` (single '-300 seconds' modifier).
// This mirrors the now-correct production SQL; keep both in sync.
const STALE_PROCESSING_SECONDS = 5 * 60;
const RECOVER_STALE = `
  UPDATE sync_queue
  SET status = 'pending'
  WHERE status = 'processing'
    AND created_at < datetime('now', '-' || ? || ' seconds')
`;

// syncEngine.ts -> getPendingMutations()
// Increment 3: only 'pending' rows are auto-synced. 'failed' rows require
// explicit attention (Retry button / retryFailedSyncs) — transient retryable
// failures stay 'pending' and never enter 'failed'.
const PENDING_SELECT = `
  SELECT table_name, record_id, operation FROM sync_queue
  WHERE status = 'pending'
    AND table_name != '_hydration'
  ORDER BY created_at ASC
`;

// ============================================================================
// Tests
// ============================================================================

test('fresh database migrates 0 -> CURRENT and matches CURRENT_SCHEMA_VERSION', async () => {
  const db = makeDb();
  assert.equal(await getSchemaVersion(db), 0);

  const version = await runMigrations(db);
  assert.equal(version, CURRENT_SCHEMA_VERSION);
  assert.equal(await getSchemaVersion(db), CURRENT_SCHEMA_VERSION);

  const names = await tableNames(db);
  assert.ok(names.includes('_migration_log'));
  assert.ok(names.includes('medications'));
  assert.ok(names.includes('daily_logs'));
  assert.ok(names.includes('daily_log_events'));
  assert.ok(names.includes('documents'));
  assert.ok(names.includes('sync_queue'));
  assert.ok(names.includes('daily_metrics_cache'));
  assert.ok(names.includes('trends_cache'));
  assert.ok(names.includes('profile_cache'));
  assert.ok(names.includes('ppg_measurements'));
  assert.ok(names.includes('rppg_measurements'));

  assert.deepEqual(await getMissingTables(db), []);
  await verifySchemaVersion(db);
});

test('migrations are idempotent on re-run', async () => {
  const db = makeDb();
  await runMigrations(db);

  await runMigrations(db);
  assert.equal(await getSchemaVersion(db), CURRENT_SCHEMA_VERSION);

  const log = await db.getAllAsync<{ version: number }>(
    `SELECT version FROM _migration_log ORDER BY version`,
  );
  assert.deepEqual(
    log.map((r) => r.version),
    [1, 2, 3, 4, 5],
    'guarded migration log must not insert duplicates',
  );
});

test('stale checkpoint is repaired back to a complete schema', async () => {
  const db = makeDb();
  await runMigrations(db);

  // Simulate the fd3c70c/dfc0afb failure mode: version claims current but a
  // table is missing from disk.
  await db.execAsync(`DROP TABLE documents`);
  await setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  assert.equal((await getMissingTables(db)).length, 1);

  await runMigrations(db);
  assert.deepEqual(await getMissingTables(db), []);
  assert.ok((await tableNames(db)).includes('documents'));

  const log = await db.getAllAsync<{ version: number }>(
    `SELECT version FROM _migration_log ORDER BY version`,
  );
  assert.deepEqual(
    log.map((r) => r.version),
    [1, 2, 3, 4, 5],
  );
});

test('verifySchemaVersion throws on genuine mismatch', async () => {
  const db = makeDb();
  await runMigrations(db);
  await setSchemaVersion(db, 2);
  await assert.rejects(verifySchemaVersion(db), /Database schema version mismatch/);
});

test('migration 5: rppg_measurements schema contract (face modality isolated)', async () => {
  const db = makeDb();
  await runMigrations(db);
  assert.equal(await getSchemaVersion(db), CURRENT_SCHEMA_VERSION);

  const cols = await db.getAllAsync<{ name: string; notnull: number; dflt_value: unknown }>(
    `PRAGMA table_info(rppg_measurements)`,
  );
  const byName = new Map(cols.map((c) => [c.name, c]));
  for (const col of [
    'measurement_id',
    'patient_id',
    'measured_at',
    'heart_rate_bpm',
    'signal_quality',
    'duration_seconds',
    'algorithm_version',
    'model_version',
    'measurement_type',
    'sampling_rate_hz',
    'face_stability',
    'reliable',
    'sync_status',
  ]) {
    assert.ok(byName.has(col), `rppg_measurements missing column ${col}`);
  }
  // Raw frames/video/face data must have nowhere to land.
  for (const banned of ['frames', 'video', 'raw_signal', 'face_data', 'tensor']) {
    assert.ok(!byName.has(banned), `rppg_measurements must not store ${banned}`);
  }
  // Face rows insert + read back with provenance intact.
  await db.runAsync(
    `INSERT INTO rppg_measurements
      (measurement_id, patient_id, measured_at, heart_rate_bpm, signal_quality,
       duration_seconds, algorithm_version, model_version, measurement_type,
       sampling_rate_hz, face_stability, reliable, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'r1',
    'p1',
    '2026-09-15T10:00:00.000Z',
    71,
    0.82,
    6,
    'rppg-1.0.0',
    'physformer-rppg-1.0.0',
    'face_rppg',
    30.0,
    0.9,
    1,
    'pending',
  );
  const row = await db.getFirstAsync<{ heart_rate_bpm: number; model_version: string }>(
    `SELECT heart_rate_bpm, model_version FROM rppg_measurements WHERE measurement_id = ?`,
    'r1',
  );
  assert.equal(row?.heart_rate_bpm, 71);
  assert.equal(row?.model_version, 'physformer-rppg-1.0.0');

  // Fingertip table is untouched by migration 5 (no new columns).
  const ppgCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(ppg_measurements)`,
  );
  const ppgNames = new Set(ppgCols.map((c) => c.name));
  assert.ok(!ppgNames.has('model_version'), 'ppg table must not gain rPPG columns');
  assert.ok(!ppgNames.has('face_stability'), 'ppg table must not gain rPPG columns');
});

test('documents table: updated_at is NOT NULL (updated_at fallback area)', async () => {
  const db = makeDb();
  await runMigrations(db);

  const nn = await notNullColumns(db, 'documents');
  assert.ok(nn.has('created_at'));
  assert.ok(nn.has('updated_at'));

  // documents.ts fallback: insert with only created_at (no updated_at).
  await db.runAsync(UPSERT_DOCUMENT, [
    'doc-1',
    'patient-1',
    'hash-1',
    '/storage/doc-1',
    'UPLOADED',
    '2025-01-01T00:00:00Z',
    '2025-01-01T00:00:00Z',
  ]);
  assert.equal((await db.getFirstAsync(`SELECT COUNT(*) AS c FROM documents`)).c, 1);

  // Re-upsert with a real updated_at -> single row, value updated.
  await db.runAsync(UPSERT_DOCUMENT, [
    'doc-1',
    'patient-1',
    'hash-1',
    '/storage/doc-1',
    'PROCESSED',
    '2025-01-01T00:00:00Z',
    '2025-01-02T00:00:00Z',
  ]);
  const row = await db.getFirstAsync<{ status: string; updated_at: string }>(
    `SELECT status, updated_at FROM documents WHERE document_id = 'doc-1'`,
  );
  assert.equal(await db.getFirstAsync(`SELECT COUNT(*) AS c FROM documents`).then((r: any) => r.c), 1);
  assert.equal(row!.status, 'PROCESSED');
  assert.equal(row!.updated_at, '2025-01-02T00:00:00Z');
});

test('sync_queue schema supports the retry machinery', async () => {
  const db = makeDb();
  await runMigrations(db);

  const cols = await columnNames(db, 'sync_queue');
  assert.ok(cols.includes('attempt_count'));
  assert.ok(cols.includes('last_error'));
  assert.ok(cols.includes('status'));
  assert.ok(cols.includes('mutation_id'));
  assert.ok(cols.includes('record_id'));
  assert.ok(cols.includes('created_at'));

  const indexes = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM pragma_index_list('sync_queue')`,
  );
  const names = indexes.map((i) => i.name);
  assert.ok(names.includes('ix_sync_status'));
  assert.ok(names.includes('ix_sync_record'));
  assert.ok(names.includes('ix_sync_mutation'));
});

test('REGRESSION recoverStaleProcessing: stale recovered, non-stale preserved, deterministic', async () => {
  const db = makeDb();
  await runMigrations(db);

  // Stale item: stuck in 'processing' for 10 minutes (> 5 min threshold).
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, status, created_at)
     VALUES ('medications', 'r-old', 'm-old', 'create', 'processing', datetime('now', '-10 minutes'))`,
  );
  // Non-stale item: entered 'processing' just now (< threshold).
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, status)
     VALUES ('medications', 'r-new', 'm-new', 'create', 'processing')`,
  );

  const changes = (await db.runAsync(RECOVER_STALE, [String(STALE_PROCESSING_SECONDS)])).changes;
  assert.equal(changes, 1, 'exactly the stale item must be recovered');

  const statuses = await db.getAllAsync<{ record_id: string; status: string }>(
    `SELECT record_id, status FROM sync_queue ORDER BY record_id`,
  );
  assert.deepEqual(
    statuses.map((r) => ({ record_id: r.record_id, status: r.status })),
    [
      { record_id: 'r-new', status: 'processing' },
      { record_id: 'r-old', status: 'pending' },
    ],
    'stale item -> pending; fresh item must NOT be recovered',
  );

  // Deterministic/idempotent: a second pass recovers nothing further.
  const changes2 = (await db.runAsync(RECOVER_STALE, [String(STALE_PROCESSING_SECONDS)])).changes;
  assert.equal(changes2, 0, 'second run must be a no-op');
});

test('sync queue: completed items cleaned up only after 24 h', async () => {
  const db = makeDb();
  await runMigrations(db);

  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, status, created_at)
     VALUES ('daily_logs', 'old', 'm-old', 'create', 'completed', datetime('now', '-2 days'))`,
  );
  await db.runAsync(
    `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, status)
     VALUES ('daily_logs', 'recent', 'm-recent', 'create', 'completed')`,
  );

  const changes = (await db.runAsync(CLEANUP_COMPLETED)).changes;
  assert.equal(changes, 1);

  const remaining = await db.getAllAsync<{ record_id: string }>(
    `SELECT record_id FROM sync_queue`,
  );
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].record_id, 'recent');
});

test('sync queue: pending selection mirrors getPendingMutations filtering', async () => {
  const db = makeDb();
  await runMigrations(db);

  const insert = (table: string, record: string, status: string, createdAt: string) =>
    db.runAsync(
      `INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, status, created_at)
       VALUES (?, ?, ?, 'create', ?, ?)`,
      [table, record, `m-${record}`, status, createdAt],
    );

  // Distinct created_at timestamps so ascending order is deterministic
  // (matches the FIFO intent of getPendingMutations).
  await insert('medications', 'a', 'pending', '2024-01-01 00:00:00');
  await insert('daily_logs', 'b', 'failed', '2024-01-02 00:00:00');
  await insert('medications', 'c', 'completed', '2024-01-03 00:00:00');
  await insert('_hydration', 'h', 'pending', '2024-01-04 00:00:00');

  const pending = await db.getAllAsync<{ table_name: string; record_id: string }>(PENDING_SELECT);
  assert.deepEqual(
    pending.map((r) => r.record_id),
    ['a'],
    "'pending' rows are auto-synced; 'failed' rows wait for explicit attention",
  );
});

test('daily log table contract: FK on daily_log_events -> daily_logs enforced', async () => {
  const db = makeDb();
  await runMigrations(db);

  const logCols = await columnNames(db, 'daily_logs');
  assert.ok(logCols.includes('group_id'));
  assert.ok(logCols.includes('patient_id'));
  assert.ok(logCols.includes('log_date'));
  assert.ok(logCols.includes('sync_status'));

  await db.runAsync(
    `INSERT INTO daily_logs (group_id, patient_id, log_date, created_at, updated_at)
     VALUES ('g1', 'patient-1', '2025-01-01', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')`,
  );

  await db.runAsync(
    `INSERT INTO daily_log_events (event_id, group_id, event_type, event_time, payload_json, created_at)
     VALUES ('e1', 'g1', 'VITAL_SIGN', '2025-01-01T09:00:00Z', '{}', '2025-01-01T09:00:00Z')`,
  );

  // FK enforcement: orphan event must fail.
  await assert.rejects(
    db.runAsync(
      `INSERT INTO daily_log_events (event_id, group_id, event_type, event_time, payload_json, created_at)
       VALUES ('e2', 'missing-group', 'VITAL_SIGN', '2025-01-01T09:00:00Z', '{}', '2025-01-01T09:00:00Z')`,
    ),
    /FOREIGN KEY constraint failed/,
  );
});

test('daily metrics cache: write/read JSON round-trip and conflict upsert', async () => {
  const db = makeDb();
  await runMigrations(db);

  const metrics = {
    latest_vitals: [
      { concept_id: null, display_name: 'Pulse', value: null, unit: null, event_time: '2025-01-01T09:00:00Z' },
    ],
    today_wellbeing: null,
    latest_pain: null,
    latest_sleep: null,
    today_activity: null,
    recent_daily_logs: [],
  };

  await db.runAsync(UPSERT_DAILY_METRICS, ['patient-1', JSON.stringify(metrics)]);

  const row1 = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM daily_metrics_cache`);
  assert.equal(row1!.c, 1);

  const read = await db.getFirstAsync<{ metrics_json: string }>(
    `SELECT metrics_json FROM daily_metrics_cache WHERE patient_id = 'patient-1'`,
  );
  const parsed = JSON.parse(read!.metrics_json);
  assert.equal(parsed.latest_vitals[0].value, null);
  assert.equal(parsed.latest_vitals[0].display_name, 'Pulse');

  await db.runAsync(UPSERT_DAILY_METRICS, ['patient-1', JSON.stringify({ ...metrics, today_wellbeing: null })]);
  const row2 = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM daily_metrics_cache`);
  assert.equal(row2!.c, 1, 'upsert must not duplicate rows');
});