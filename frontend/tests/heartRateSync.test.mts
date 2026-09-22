/**
 * heartRateSync — Phase 3 tests for measurement → SQLite → dial propagation.
 *
 * Proves, without a device or server:
 *   - the REAL unified feed SQL (both modalities, one query) returns
 *     newest-first rows with provenance, excludes null-HR (failed runs),
 *     stays patient-scoped, and honors limit — executed against real
 *     in-memory SQLite via node:sqlite (same facade pattern as
 *     migrations.test.mts; only the DDL is mirrored, the SQL under test is
 *     production code imported from db/queries/heartRate.ts)
 *   - day-collapse (latest per day wins) and dial merge (camera wins
 *     same-day ties, server days preserved) are deterministic
 *   - the existing dataRefresh pub/sub fires subscribers exactly once per
 *     request and resets on consume (the immediate-update mechanism)
 *   - wiring guards: services announce AFTER local insert and BEFORE the
 *     POST (local UI never waits on network), mark synced only after POST
 *     success (4xx/5xx keeps the valid local row), single INSERT per service
 *     (no duplicate-write path), PPG double-start guard, hook subscription +
 *     patient-null isolation, dashboard merge + refetch wiring
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/heartRateSync.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  mergeHeartRateSeries,
  queryRecentLocalHeartRates,
  toHeartDayPoints,
  type LocalHeartRatePoint,
} from '../src/db/queries/heartRate.ts';
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

// Minimal facade over node:sqlite matching the expo-sqlite subset used by
// the heart-rate feed (mirrors migrations.test.mts makeDb).
function makeDb() {
  const s = new DatabaseSync(':memory:');
  return {
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...params) as T[];
    },
    exec(sql: string): void {
      s.exec(sql);
    },
  };
}

// Mirrored DDL: only the columns the unified feed reads. The SQL under test
// is production code; this DDL just gives it tables to run against.
const DDL = `
  CREATE TABLE ppg_measurements (
    measurement_id TEXT PRIMARY KEY, patient_id TEXT, measured_at TEXT,
    heart_rate_bpm REAL, signal_quality REAL, reliable INTEGER, sync_status TEXT
  );
  CREATE TABLE rppg_measurements (
    measurement_id TEXT PRIMARY KEY, patient_id TEXT, measured_at TEXT,
    heart_rate_bpm REAL, signal_quality REAL, reliable INTEGER, sync_status TEXT
  );
`;

function seedDb(): ReturnType<typeof makeDb> {
  const db = makeDb();
  db.exec(DDL);
  db.exec(`
    INSERT INTO ppg_measurements VALUES
      ('ppg-1', 'pat-A', '2026-09-10T08:00:00.000Z', 68, 0.8, 1, 'synced'),
      ('ppg-2', 'pat-A', '2026-09-12T08:00:00.000Z', 72, 0.9, 1, 'pending'),
      ('ppg-null', 'pat-A', '2026-09-13T08:00:00.000Z', NULL, 0.1, 0, 'pending'),
      ('ppg-other', 'pat-B', '2026-09-14T08:00:00.000Z', 200, 0.9, 1, 'pending');
    INSERT INTO rppg_measurements VALUES
      ('rppg-1', 'pat-A', '2026-09-11T08:00:00.000Z', 70, 0.6, 0, 'synced'),
      ('rppg-2', 'pat-A', '2026-09-12T18:00:00.000Z', 75, 0.85, 1, 'pending'),
      ('rppg-other', 'pat-B', '2026-09-15T08:00:00.000Z', 201, 0.9, 1, 'pending');
  `);
  return db;
}

// ============================================================================
// Unified feed SQL — both modalities, one query, patient-scoped
// ============================================================================

describe('unified local heart-rate feed', () => {
  test('returns PPG + RPPG newest-first with provenance', async () => {
    const rows = await queryRecentLocalHeartRates(seedDb(), 'pat-A', 30);
    assert.deepEqual(
      rows.map((r) => [r.measurementId, r.method, r.bpm]),
      [
        ['rppg-2', 'rppg', 75],
        ['ppg-2', 'ppg', 72],
        ['rppg-1', 'rppg', 70],
        ['ppg-1', 'ppg', 68],
      ],
    );
  });

  test('null-HR (failed/insufficient) runs never enter the feed', async () => {
    const rows = await queryRecentLocalHeartRates(seedDb(), 'pat-A', 30);
    assert.ok(rows.every((r) => Number.isFinite(r.bpm)));
    assert.ok(!rows.some((r) => r.measurementId === 'ppg-null'));
  });

  test('patient isolation: no cross-user rows', async () => {
    const a = await queryRecentLocalHeartRates(seedDb(), 'pat-A', 30);
    const b = await queryRecentLocalHeartRates(seedDb(), 'pat-B', 30);
    assert.ok(a.every((r) => r.bpm < 100));
    assert.deepEqual(
      b.map((r) => r.bpm).sort((x, y) => x - y),
      [200, 201],
    );
    assert.equal(await queryRecentLocalHeartRates(seedDb(), 'nobody', 30).then((r) => r.length), 0);
  });

  test('limit is honored', async () => {
    const rows = await queryRecentLocalHeartRates(seedDb(), 'pat-A', 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].measurementId, 'rppg-2');
  });

  test('reliable flag survives (borderline stays distinguishable)', async () => {
    const rows = await queryRecentLocalHeartRates(seedDb(), 'pat-A', 30);
    const borderline = rows.find((r) => r.measurementId === 'rppg-1');
    assert.equal(borderline?.reliable, 0);
    assert.equal(borderline?.bpm, 70);
  });
});

// ============================================================================
// Day collapse + dial merge — deterministic, camera wins ties
// ============================================================================

describe('day collapse and dial merge', () => {
  const rows: LocalHeartRatePoint[] = [
    { measurementId: 'a', method: 'ppg', bpm: 68, measuredAt: '2026-09-10T08:00:00.000Z', signalQuality: 0.8, reliable: 1 },
    { measurementId: 'b', method: 'rppg', bpm: 75, measuredAt: '2026-09-12T18:00:00.000Z', signalQuality: 0.85, reliable: 1 },
    { measurementId: 'c', method: 'ppg', bpm: 72, measuredAt: '2026-09-12T08:00:00.000Z', signalQuality: 0.9, reliable: 1 },
  ];

  test('latest measurement of the day wins, ascending output', () => {
    assert.deepEqual(toHeartDayPoints(rows), [
      { date: '2026-09-10', value: 68, time: '2026-09-10T08:00:00.000Z', method: 'ppg' },
      { date: '2026-09-12', value: 75, time: '2026-09-12T18:00:00.000Z', method: 'rppg' },
    ]);
  });

  test('malformed dates are skipped, never crash the dial', () => {
    const bad: LocalHeartRatePoint[] = [
      { measurementId: 'x', method: 'ppg', bpm: 70, measuredAt: 'not-a-date', signalQuality: 0.8, reliable: 1 },
    ];
    assert.deepEqual(toHeartDayPoints(bad), []);
  });

  test('camera wins same-day ties; server-only days preserved; sorted', () => {
    const merged = mergeHeartRateSeries(
      [
        { date: '2026-09-10', value: 66 },
        { date: '2026-09-11', value: 71 },
      ],
      [
        { date: '2026-09-10', value: 68, time: '2026-09-10T08:00:00.000Z', method: 'ppg' },
        { date: '2026-09-12', value: 75, time: '2026-09-12T18:00:00.000Z', method: 'rppg' },
      ],
    );
    assert.deepEqual(merged, [
      { date: '2026-09-10', value: 68 },
      { date: '2026-09-11', value: 71 },
      { date: '2026-09-12', value: 75 },
    ]);
  });

  test('empty camera feed leaves the server series untouched', () => {
    const existing = [{ date: '2026-09-11', value: 71 }];
    assert.deepEqual(mergeHeartRateSeries(existing, []), existing);
    assert.deepEqual(mergeHeartRateSeries([], []), []);
  });
});

// ============================================================================
// dataRefresh pub/sub — the immediate-update mechanism
// ============================================================================

describe('dataRefresh propagation', () => {
  test('request notifies subscribers; consume resets exactly once', () => {
    let calls = 0;
    const unsub = subscribeDataRefresh(() => {
      calls += 1;
    });
    try {
      assert.equal(consumeDataRefreshRequest(), false);
      requestDataRefresh();
      assert.equal(calls, 1);
      assert.equal(consumeDataRefreshRequest(), true);
      assert.equal(consumeDataRefreshRequest(), false);
    } finally {
      unsub();
    }
  });

  test('a broken subscriber never breaks the save flow', () => {
    const bad = subscribeDataRefresh(() => {
      throw new Error('boom');
    });
    let good = 0;
    const ok = subscribeDataRefresh(() => {
      good += 1;
    });
    try {
      requestDataRefresh();
      assert.equal(good, 1);
    } finally {
      bad();
      ok();
    }
    consumeDataRefreshRequest();
  });
});

// ============================================================================
// Wiring guards — propagation order, sync safety, isolation
// ============================================================================

describe('phase 3 wiring', () => {
  test('services announce AFTER local insert and BEFORE the POST', () => {
    for (const rel of ['src/services/ppgService.ts', 'src/services/rppgService.ts']) {
      const s = src(rel);
      const insertName =
        rel === 'src/services/ppgService.ts'
          ? 'insertPpgMeasurement(patientId, input)'
          : 'insertRppgMeasurement(patientId, input)';
      const insertAt = s.indexOf(insertName);
      // The call, not the import: imports mention the name without parens.
      const announceAt = s.indexOf('requestDataRefresh();');
      const postAt = s.indexOf("api.post('/api/v1/ppg/measurements'");
      assert.ok(insertAt > 0 && announceAt > 0 && postAt > 0, rel);
      assert.ok(insertAt < announceAt && announceAt < postAt, rel);
    }
  });

  test('synced is marked only after POST success; failures stay pending', () => {
    for (const [rel, markCall] of [
      ['src/services/ppgService.ts', 'await markPpgSynced('],
      ['src/services/rppgService.ts', 'await markRppgSynced('],
    ] as const) {
      const s = src(rel);
      // Services delegate inserts to db/queries: no INSERT statement lives here.
      assert.equal(s.split('INSERT INTO').length - 1, 0, `${rel}: services delegate inserts to db/queries`);
      const postAt = s.indexOf("api.post('/api/v1/ppg/measurements'");
      const markAt = s.indexOf(markCall);
      assert.ok(postAt > 0 && markAt > postAt, rel);
    }
  });

  test('PPG hook guards concurrent starts (local duplicate prevention)', () => {
    const hook = src('src/hooks/usePpgMeasurement.ts');
    assert.ok(hook.includes('startInFlightRef'));
    assert.ok(hook.includes('finally'));
  });

  test('local HR hook is patient-scoped, live-subscribed, focus-reloaded', () => {
    const hook = src('src/hooks/useLocalHeartRate.ts');
    assert.ok(hook.includes('getCachedPatientId()'));
    assert.ok(hook.includes('subscribeDataRefresh'));
    assert.ok(hook.includes('useFocusEffect'));
    assert.ok(hook.includes('getRecentLocalHeartRates'));
  });

  test('dashboard merges the camera feed and refetches it', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes('useLocalHeartRate()'));
    assert.ok(dash.includes('useDialMetrics'), 'shared dial pipeline');
    assert.ok(dash.includes('localHr.refetch()'));
    assert.ok(dash.includes('localHr.points'));
    // Merge math lives once in the shared hook (dashboard + Priority world).
    const hook = src('src/hooks/useDialMetrics.ts');
    assert.ok(hook.includes("byId.set('hr', mergeHeartRateSeries"));
  });

  test('failed/insufficient runs never reach the save path', () => {
    const ppg = src('src/hooks/usePpgMeasurement.ts');
    assert.ok(
      ppg.indexOf('if (r.heartRateBpm == null)') < ppg.indexOf('await saveAndSyncPpgResult('),
    );
    const rppg = src('src/hooks/useRppgMeasurement.ts');
    assert.ok(
      rppg.indexOf("quality.level === 'insufficient'") <
        rppg.indexOf('await saveAndSyncRppgResult('),
    );
  });
});
