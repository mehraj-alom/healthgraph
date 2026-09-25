/**
 * patientErase — Phase 5 tests for the deletion lifecycle.
 *
 * Behavioral coverage (real in-memory SQLite via node:sqlite):
 *   - wipePatientTables removes ONLY the target patient's rows across every
 *     health table + caches + hydration flag + owned queue rows
 *   - the other patient's rows are fully intact (isolation)
 *   - legacy queue rows attributed via payload are removed; unattributable
 *     rows fail closed (stay) so they can never be mis-deleted
 *   - wipe is idempotent (second run deletes zero rows)
 * plus wiring guards (text-level, repo precedent) for the RN-bound layers:
 *   - server-before-local order in deletion.ts (offline fails closed)
 *   - Danger Zone wired to real flows (no UI-only strings), double-submit
 *     guards, post-state (logout path for account, RQ clear for data)
 *   - backend route + orchestrator wiring markers
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/patientErase.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { wipePatientTables } from '../src/db/queries/patientErase.ts';

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

// Facade over node:sqlite matching the PatientEraseDb surface.
function makeDb() {
  const s = new DatabaseSync(':memory:');
  return {
    async runAsync(sql: string, ...params: unknown[]) {
      const r = s.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...params) as T[];
    },
    exec(sql: string): void {
      s.exec(sql);
    },
  };
}

// Minimal DDL mirroring the production tables the wipe touches (columns the
// wipe's WHERE clauses reference; the DELETE statements under test are
// production code).
const DDL = `
  CREATE TABLE medications (medication_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE medication_taken_events (event_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE daily_logs (group_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE daily_log_events (event_id TEXT PRIMARY KEY, group_id TEXT);
  CREATE TABLE observations (observation_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE body_state_snapshots (id INTEGER PRIMARY KEY, patient_id TEXT);
  CREATE TABLE documents (document_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE profile_cache (patient_id TEXT PRIMARY KEY);
  CREATE TABLE daily_metrics_cache (patient_id TEXT PRIMARY KEY);
  CREATE TABLE trends_cache (patient_id TEXT PRIMARY KEY);
  CREATE TABLE trends_cache_new (patient_id TEXT PRIMARY KEY);
  CREATE TABLE scan_sessions (session_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE ppg_measurements (measurement_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE rppg_measurements (measurement_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE substance_entries (entry_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE cycle_entries (entry_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE food_scan_items (scan_id TEXT PRIMARY KEY, patient_id TEXT);
  CREATE TABLE onboarding_state (patient_id TEXT PRIMARY KEY, completed INTEGER);
  CREATE TABLE reminder_instances (occurrence_id TEXT PRIMARY KEY, patient_id TEXT, medication_id TEXT, scheduled_at TEXT);
  CREATE TABLE hydration_state (scope TEXT, key TEXT, value TEXT);
  CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, table_name TEXT, record_id TEXT, patient_id TEXT, payload_json TEXT, status TEXT);
`;

function seedDb() {
  const db = makeDb();
  db.exec(DDL);
  const A = 'pat-A';
  const B = 'pat-B';
  db.exec(`
    INSERT INTO medications VALUES ('m-a1','${A}'), ('m-b1','${B}');
    INSERT INTO medication_taken_events VALUES ('t-a1','${A}'), ('t-b1','${B}');
    INSERT INTO daily_logs VALUES ('g-a1','${A}'), ('g-b1','${B}');
    INSERT INTO daily_log_events VALUES ('e-a1','g-a1'), ('e-orphan','g-orphan'), ('e-b1','g-b1');
    INSERT INTO observations VALUES ('o-a1','${A}'), ('o-b1','${B}');
    INSERT INTO body_state_snapshots VALUES (1,'${A}'), (2,'${B}');
    INSERT INTO documents VALUES ('d-a1','${A}'), ('d-b1','${B}');
    INSERT INTO profile_cache VALUES ('${A}'), ('${B}');
    INSERT INTO daily_metrics_cache VALUES ('${A}'), ('${B}');
    INSERT INTO trends_cache VALUES ('${A}'), ('${B}');
    INSERT INTO trends_cache_new VALUES ('${A}'), ('${B}');
    INSERT INTO scan_sessions VALUES ('s-a1','${A}'), ('s-b1','${B}');
    INSERT INTO ppg_measurements VALUES ('p-a1','${A}'), ('p-b1','${B}');
    INSERT INTO rppg_measurements VALUES ('r-a1','${A}'), ('r-b1','${B}');
    INSERT INTO substance_entries VALUES ('u-a1','${A}'), ('u-b1','${B}');
    INSERT INTO cycle_entries VALUES ('c-a1','${A}'), ('c-b1','${B}');
    INSERT INTO food_scan_items VALUES ('f-a1','${A}'), ('f-b1','${B}');
    INSERT INTO onboarding_state VALUES ('${A}',1), ('${B}',0);
    INSERT INTO reminder_instances VALUES ('r-a1','${A}','m-a1','08:00'), ('r-b1','${B}','m-b1','08:00');
    INSERT INTO hydration_state VALUES ('taken-events','taken_hydrated:${A}','{}'), ('taken-events','taken_hydrated:${B}','{}');
    INSERT INTO sync_queue (table_name, record_id, patient_id, payload_json, status) VALUES
      ('medications','m-a1','${A}','{}','pending'),
      ('medications','m-b1','${B}','{}','pending'),
      ('medications','m-legacy-a',NULL,'{"patient_id":"${A}"}','pending'),
      ('medications','m-legacy-b',NULL,'{"patient_id":"${B}"}','pending'),
      ('medications','m-legacy-unknown',NULL,'{}','pending'),
      ('medications','m-legacy-broken',NULL,'not-json','pending');
  `);
  return db;
}

async function count(db: ReturnType<typeof makeDb>, table: string): Promise<number> {
  const rows = await db.getAllAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return rows[0].n;
}

// ============================================================================
// Local wipe — real deletes, real isolation
// ============================================================================

describe('wipePatientTables', () => {
  test("removes ONLY the target patient's rows everywhere", async () => {
    const db = seedDb();
    const counts = await wipePatientTables(db, 'pat-A');
    assert.ok((counts['medications'] ?? 0) >= 1);
    assert.ok((counts['sync_queue'] ?? 0) >= 1);
    for (const table of [
      'medications', 'medication_taken_events', 'daily_logs', 'observations',
      'body_state_snapshots', 'documents', 'profile_cache', 'daily_metrics_cache',
      'trends_cache', 'trends_cache_new', 'scan_sessions', 'ppg_measurements',
      'rppg_measurements', 'substance_entries', 'cycle_entries', 'food_scan_items', 'onboarding_state',
    ]) {
      const remaining = await db.getAllAsync<{ patient_id: string }>(
        `SELECT patient_id FROM ${table}`,
      );
      assert.ok(remaining.length > 0, `${table}: fixture must keep B rows`);
      assert.ok(
        remaining.every((r) => r.patient_id === 'pat-B'),
        `${table}: only pat-B rows may remain`,
      );
    }
  });

  test('child events follow their groups; orphan-group events are preserved', async () => {
    const db = seedDb();
    await wipePatientTables(db, 'pat-A');
    const events = await db.getAllAsync<{ event_id: string }>(
      'SELECT event_id FROM daily_log_events',
    );
    const ids = events.map((e) => e.event_id).sort();
    // e-a1 (pat-A group) gone; e-b1 kept; e-orphan kept (no attributable owner).
    assert.deepEqual(ids, ['e-b1', 'e-orphan']);
  });

  test('hydration flag is per-patient', async () => {
    const db = seedDb();
    await wipePatientTables(db, 'pat-A');
    const keys = await db.getAllAsync<{ key: string }>('SELECT key FROM hydration_state');
    assert.deepEqual(keys.map((k) => k.key), ['taken_hydrated:pat-B']);
  });

  test('legacy queue rows: attributed removed, unattributable fail closed', async () => {
    const db = seedDb();
    const counts = await wipePatientTables(db, 'pat-A');
    assert.equal(counts['sync_queue_legacy'], 1);
    const remaining = await db.getAllAsync<{ record_id: string }>(
      'SELECT record_id FROM sync_queue ORDER BY record_id',
    );
    assert.deepEqual(
      remaining.map((r) => r.record_id),
      ['m-b1', 'm-legacy-b', 'm-legacy-broken', 'm-legacy-unknown'],
    );
  });

  test('wipe is idempotent (second run deletes zero)', async () => {
    const db = seedDb();
    await wipePatientTables(db, 'pat-A');
    const second = await wipePatientTables(db, 'pat-A');
    assert.ok(Object.values(second).every((n) => n === 0));
    // And pat-B still fully intact afterwards.
    assert.equal(await count(db, 'medications'), 1);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers (text-level, repo precedent)
// ============================================================================

describe('phase 5 wiring', () => {
  test('deletion service is server-first (offline fails closed, nothing wiped)', () => {
    const svc = src('src/services/deletion.ts');
    for (const [fn, endpoint] of [
      ['deleteAllHealthData', '/api/v1/privacy/data'],
      ['deleteAccountCompletely', '/api/v1/privacy/account'],
    ] as const) {
      const body = svc.slice(svc.indexOf(`export async function ${fn}`));
      const serverAt = body.indexOf(endpoint);
      const wipeAt = body.indexOf('wipeLocal(');
      assert.ok(serverAt > 0 && wipeAt > serverAt, fn);
    }
    assert.ok(svc.includes('PROFILE_PHOTO_STORAGE_KEY'), 'account wipe removes local photo');
    assert.ok(svc.includes('PROFILE_PHOTO_DIR'), 'account wipe removes the persisted photo file');
  });

  test('Danger Zone is wired to real flows (no UI-only strings)', () => {
    const screen = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(!screen.includes('UI only'), 'preview copy removed');
    assert.ok(screen.includes('deleteAllHealthData'), 'data flow wired');
    assert.ok(screen.includes('deleteAccountCompletely'), 'account flow wired');
    assert.ok(screen.includes('queryClient.clear()'), 'RQ cleared after wipe');
    // Double-submit prevention on both destructive actions.
    assert.ok(screen.includes("useState<'data' | 'account' | null>"), 'busy guard state');
    // Post-account state: explicit sign-out after deletion completes.
    const accountFlow = screen.slice(screen.indexOf('runDeleteAccount'));
    assert.ok(accountFlow.includes('logout()'), 'logout after account deletion');
  });

  test('backend exposes both erasure endpoints with honest reports', () => {
    const privacy = fs.readFileSync(
      path.join(ROOT, '..', 'app', 'api', 'v1', 'privacy.py'),
      'utf8',
    );
    assert.ok(privacy.includes('DELETE /privacy/data') || privacy.includes('"/data"'), 'data route');
    assert.ok(privacy.includes('DELETE /privacy/account') || privacy.includes('"/account"'), 'account route');
    assert.ok(privacy.includes('orchestrate_erasure'), 'orchestrator wired');
    assert.ok(privacy.includes('partial'), 'partial status representable');
  });
});
