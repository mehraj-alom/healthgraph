/**
 * batch6h.test.mts — Heart Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (heartEngine.ts is zero-import). HR
 * change rules are parity-checked against the shared changes.ts contract.
 * The canonical unified feed (heartRate.ts) is exercised through its test
 * seam with patient-isolation checks. RN-bound layers are pinned by
 * source-text contract. Absences (no resting HR, no SpO2, no min/max
 * range, no scores, no diagnoses, no migration) are tested as absences.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HEART_ENGINE_ID,
  HEART_FEED_LIMIT,
  describeHeartChange,
  formatBpm,
  formatMeasuredAt,
  formatMs,
  heartDayKey,
  isHeartEngineActive,
  latestHeartPoint,
  methodLabel,
  priorWeekHeart,
  summarizeHeart,
  summarizeHrv,
  trailingWeekHeart,
  type HeartPoint,
} from '../src/screens/HeartEngine/heartEngine.ts';
import {
  deriveActiveEngines,
  ENGINES,
} from '../src/screens/HealthAreas/engines.ts';
import {
  areaRouteName,
  buildHealthAreas,
  orderAreasByEngines,
} from '../src/screens/HealthAreas/areas.ts';
import {
  describeChange,
  summarize,
} from '../src/screens/HealthAreas/changes.ts';
import {
  queryRecentLocalHeartRates,
  RECENT_HEART_RATES_SQL,
  toHeartDayPoints,
} from '../src/db/queries/heartRate.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21';

const P = (
  measuredAt: string,
  bpm: number,
  method: 'ppg' | 'rppg' = 'ppg',
  reliable = 1,
): HeartPoint => ({ measuredAt, bpm, method, signalQuality: 0.9, reliable });

// ============================================================================
// Activation — heart ∈ activeEngines via the Batch 6A system
// ============================================================================

describe('heart engine activation', () => {
  test('engine id is the 6A heart selection', () => {
    assert.equal(HEART_ENGINE_ID, 'heart');
  });

  test('selected heart activates; unselected does not', () => {
    assert.equal(isHeartEngineActive(['heart']), true);
    assert.equal(isHeartEngineActive(['heart', 'sleep']), true);
    assert.equal(isHeartEngineActive([]), false);
    assert.equal(isHeartEngineActive(['fitness', 'nutrition']), false);
  });

  test('deriveActiveEngines carries heart through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['heart']).map((e) => e.id),
      ['heart'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('heart catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.heart.route?.name, 'HeartEngine');
  });

  test('heart hub area routes to the engine', () => {
    assert.equal(areaRouteName('heart'), 'HeartEngine');
  });

  test('heart area pins when active, hub order otherwise stable', () => {
    const areas = [{ id: 'sleep' }, { id: 'heart' }, { id: 'medications' }] as {
      id: 'sleep' | 'heart' | 'medications';
    }[];
    assert.deepEqual(
      orderAreasByEngines(areas, ['heart']).map((a) => a.id),
      ['heart', 'sleep', 'medications'],
    );
    assert.deepEqual(
      orderAreasByEngines(areas, []).map((a) => a.id),
      ['sleep', 'heart', 'medications'],
    );
  });

  test('deselecting heart deletes nothing (selection-only)', () => {
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('ppg_measurements'), 'focus never touches PPG');
    assert.ok(!hook.includes('rppg_measurements'), 'focus never touches RPPG');
  });
});

// ============================================================================
// Canonical feed — patient isolation, modality separation, null refusal
// ============================================================================

describe('canonical heart-rate feed', () => {
  function makeDb(rows: Record<string, unknown>[]) {
    return {
      getAllAsync: async <T,>() => rows as T[],
    };
  }

  test('unified SQL scopes each leg to the patient and drops null HR', () => {
    assert.ok(RECENT_HEART_RATES_SQL.includes('ppg_measurements'), 'PPG leg');
    assert.ok(RECENT_HEART_RATES_SQL.includes('rppg_measurements'), 'RPPG leg');
    assert.ok(RECENT_HEART_RATES_SQL.includes('patient_id = ?'), 'patient scope');
    assert.ok(RECENT_HEART_RATES_SQL.includes('heart_rate_bpm IS NOT NULL'), 'null-HR exclusion');
    assert.ok(RECENT_HEART_RATES_SQL.includes('UNION ALL'), 'single query, no N+1');
  });

  test('feed preserves modality and refuses malformed rows', async () => {
    const rows = await queryRecentLocalHeartRates(
      makeDb([
        { measurement_id: 'a', measured_at: '2026-09-20T08:00:00Z', heart_rate_bpm: 72, signal_quality: 0.9, reliable: 1, method: 'ppg' },
        { measurement_id: 'b', measured_at: '2026-09-20T09:00:00Z', heart_rate_bpm: 68, signal_quality: 0.7, reliable: 0, method: 'rppg' },
        { measurement_id: 'c', measured_at: '2026-09-20T10:00:00Z', heart_rate_bpm: null, signal_quality: 0.1, reliable: 0, method: 'ppg' },
        { measurement_id: 'd', measured_at: '2026-09-20T11:00:00Z', heart_rate_bpm: 70, signal_quality: 0.8, reliable: 1, method: 'watch' },
      ]),
      'pat-A',
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.measurementId, r.method]),
      [['a', 'ppg'], ['b', 'rppg']],
    );
  });

  test('day collapse keeps the latest measurement per day with its method', () => {
    const days = toHeartDayPoints([
      { measurementId: 'a', method: 'rppg', bpm: 68, measuredAt: '2026-09-20T08:00:00Z', signalQuality: 0.7, reliable: 0 },
      { measurementId: 'b', method: 'ppg', bpm: 72, measuredAt: '2026-09-20T18:00:00Z', signalQuality: 0.9, reliable: 1 },
    ]);
    assert.equal(days.length, 1);
    assert.deepEqual([days[0].value, days[0].method], [72, 'ppg']);
  });
});

// ============================================================================
// No-data state — empty in, nulls out (never zeros)
// ============================================================================

describe('no-data state', () => {
  test('empty feed summarizes to nulls, not zeros', () => {
    const s = summarizeHeart([]);
    assert.equal(s.measurements, 0);
    assert.equal(s.avgBpm, null);
    assert.equal(s.measuredDays, 0);
    assert.equal(s.reliableCount, 0);
  });

  test('empty weeks yield no change line; no latest point', () => {
    assert.equal(describeHeartChange([], []), null);
    assert.equal(latestHeartPoint([]), null);
  });

  test('empty HRV summarizes to nulls (never a zero trend)', () => {
    const h = summarizeHrv([]);
    assert.equal(h.sessions, 0);
    assert.equal(h.latest, null);
    assert.equal(h.avgRmssdMs, null);
  });
});

// ============================================================================
// Real-data state — latest, averages, measured days, changes
// ============================================================================

describe('real-data state', () => {
  test('latest is the newest instant with its modality intact', () => {
    const latest = latestHeartPoint([
      P('2026-09-20T08:00:00Z', 72, 'ppg'),
      P('2026-09-20T18:00:00Z', 68, 'rppg', 0),
    ]);
    assert.deepEqual([latest?.bpm, latest?.method], [68, 'rppg']);
  });

  test('summary averages measured rows and counts reliable share', () => {
    const s = summarizeHeart([
      P('2026-09-18T08:00:00Z', 70, 'ppg'),
      P('2026-09-19T08:00:00Z', 74, 'ppg', 0),
      P('2026-09-19T18:00:00Z', 72, 'rppg'),
    ]);
    assert.equal(s.measurements, 3);
    assert.equal(s.avgBpm, 72);
    assert.equal(s.measuredDays, 2);
    assert.equal(s.reliableCount, 2);
  });

  test('sparse single measurement: summary exists, change stays null', () => {
    const points = [P('2026-09-20T08:00:00Z', 72, 'ppg')];
    assert.equal(summarizeHeart(points).avgBpm, 72);
    assert.equal(
      describeHeartChange(trailingWeekHeart(points, TODAY), priorWeekHeart(points, TODAY)),
      null,
    );
  });

  test('two-window data produces a descriptive absolute line', () => {
    const points = [
      P('2026-09-10T08:00:00Z', 68, 'ppg'),
      P('2026-09-11T08:00:00Z', 70, 'rppg'),
      P('2026-09-19T08:00:00Z', 72, 'ppg'),
      P('2026-09-20T08:00:00Z', 74, 'ppg'),
    ];
    assert.equal(
      describeHeartChange(trailingWeekHeart(points, TODAY), priorWeekHeart(points, TODAY)),
      'Average HR +4 bpm vs prior week',
    );
  });

  test('identical weeks yield a zero line, not null', () => {
    const points = [P('2026-09-10T08:00:00Z', 72, 'ppg'), P('2026-09-20T08:00:00Z', 72, 'rppg')];
    assert.equal(
      describeHeartChange(trailingWeekHeart(points, TODAY), priorWeekHeart(points, TODAY)),
      'Average HR → 0 bpm vs prior week',
    );
  });

  test('malformed timestamps never crash windowing', () => {
    assert.equal(heartDayKey('garbage'), null);
    assert.equal(heartDayKey(''), null);
    const s = summarizeHeart([P('garbage', 72, 'ppg')]);
    assert.equal(s.measurements, 1);
    assert.equal(s.measuredDays, 0);
  });

  test('display preserves units and modality', () => {
    assert.equal(formatBpm(72.4), '72 bpm');
    assert.equal(formatMs(42.3), '42 ms');
    assert.equal(methodLabel('ppg'), 'Fingertip PPG');
    assert.equal(methodLabel('rppg'), 'Face RPPG');
    assert.ok(!formatMeasuredAt('2026-09-20T08:00:00Z').includes('resting'), 'never resting');
  });
});

// ============================================================================
// HRV — persisted PPG scalars only, honest absence otherwise
// ============================================================================

describe('hrv behavior', () => {
  test('latest and average RMSSD from persisted rows with units intact', () => {
    const h = summarizeHrv([
      { measuredAt: '2026-09-18T08:00:00Z', rmssdMs: 38, sdnnMs: 50 },
      { measuredAt: '2026-09-20T08:00:00Z', rmssdMs: 46, sdnnMs: null },
    ]);
    assert.equal(h.sessions, 2);
    assert.equal(h.latest?.rmssdMs, 46);
    assert.equal(h.latest?.sdnnMs, null);
    assert.equal(h.avgRmssdMs, 42);
  });

  test('hook sources HRV from PPG history only (never RPPG)', () => {
    const hook = src('src/hooks/useHeartEngine.ts');
    assert.ok(hook.includes('getRecentPpgMeasurements'), 'PPG history for HRV');
    assert.ok(!hook.includes('getRecentRppgMeasurements'), 'no RPPG HRV read');
    assert.ok(hook.includes('rmssd_ms'), 'RMSSD persistence gate');
  });

  test('engine never converts HRV into stress/recovery/readiness', () => {
    const hay = [
      src('src/screens/HeartEngine/heartEngine.ts'),
      src('src/screens/HeartEngine/HeartEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of ['stress score', 'recovery score', 'readiness', 'hrv proves']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});

// ============================================================================
// Parity — engine math matches the shared changes.ts contract
// ============================================================================

describe('changes.ts parity', () => {
  test('HR averages mirror mode average absolute deltas', () => {
    const cases: [HeartPoint[], HeartPoint[]][] = [
      [[P('2026-09-20T08:00:00Z', 74)], [P('2026-09-10T08:00:00Z', 68)]],
      [[P('2026-09-20T08:00:00Z', 72)], [P('2026-09-10T08:00:00Z', 72)]],
      [[], [P('2026-09-10T08:00:00Z', 72)]],
      [[P('2026-09-20T08:00:00Z', 72)], []],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map((p) => p.bpm)),
        previous: summarize(prev.map((p) => p.bpm)),
        mode: 'average',
        unit: 'bpm',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      const actual = describeHeartChange(cur, prev);
      assert.equal(actual, expected === null ? null : `Average HR ${expected}`);
    }
  });
});

// ============================================================================
// Hub area — unchanged real-data behavior, new destination
// ============================================================================

describe('heart hub area', () => {
  const base = {
    heartBpm: null,
    serverHeartBpm: null,
    loggedDays: 0,
    activeMedications: 0,
    documentCount: 0,
    substanceEntries: 0,
    cycleEntries: 0,
    profileWeightKg: null as number | null,
    activeDays7: 0,
    activitySessions7: 0,
    nutritionMeals7: 0,
    wellbeingDays7: 0,
  };

  test('local measurement headline and provenance are unchanged', () => {
    const area = buildHealthAreas({ ...base, heartBpm: 72.4 }).find((a) => a.id === 'heart');
    assert.deepEqual([area?.status, area?.source], ['available', 'device']);
    assert.equal(area?.headline, '72 bpm');
    assert.equal(area?.detail, 'Measured on this device');
  });

  test('no measurements still reports no-data', () => {
    const area = buildHealthAreas(base).find((a) => a.id === 'heart');
    assert.deepEqual([area?.status, area?.source], ['no-data', 'none']);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6h wiring', () => {
  test('engine hook reuses the canonical feed (no second query system)', () => {
    const hook = src('src/hooks/useHeartEngine.ts');
    assert.ok(hook.includes('getRecentLocalHeartRates'), 'canonical unified feed');
    assert.ok(!hook.includes('SELECT'), 'no inline SQL duplication');
    assert.ok(hook.includes('getRecentPpgMeasurements'), 'existing PPG history for HRV');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(hook.includes('HEART_FEED_LIMIT'), 'bounded feed');
  });

  test('dial and engine share the feed (no fork)', () => {
    const dial = src('src/hooks/useLocalHeartRate.ts');
    const hook = src('src/hooks/useHeartEngine.ts');
    assert.ok(dial.includes('getRecentLocalHeartRates'), 'dial canonical path');
    assert.ok(hook.includes('getRecentLocalHeartRates'), 'engine canonical path');
  });

  test('HeartEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('HeartEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="HeartEngine"'), 'route registered');
    assert.ok(app.includes('HeartEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'HeartEngine'"), 'hub dispatch handles it');
  });

  test('PPG/RPPG measurement flow is intact (engine adds, never replaces)', () => {
    const app = src('App.tsx');
    assert.ok(app.includes('name="PpgMeasure"') || app.includes('PpgMeasure'), 'PPG flow intact');
    const screen = src('src/screens/HeartEngine/HeartEngineScreen.tsx');
    assert.ok(screen.includes('PpgMeasure'), 'engine links to the existing flow');
  });

  test('measurement rows are wiped with the patient (no orphans)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'ppg_measurements'"), 'PPG rows wiped');
    assert.ok(erase.includes("'rppg_measurements'"), 'RPPG rows wiped');
  });

  test('no resting-HR label, no SpO2 card, no min/max range anywhere', () => {
    const hay = [
      src('src/screens/HeartEngine/heartEngine.ts'),
      src('src/screens/HeartEngine/HeartEngineScreen.tsx'),
      src('src/hooks/useHeartEngine.ts'),
    ].join('\n');
    assert.ok(!hay.toLowerCase().includes('resting'), 'never labeled resting');
    assert.ok(!hay.toLowerCase().includes('spo2'), 'no SpO2 card');
    assert.ok(!hay.toLowerCase().includes('spo_2'), 'no SpO2 card');
    assert.ok(!hay.includes('Math.min') && !hay.includes('Math.max'), 'no min/max range');
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/HeartEngine/heartEngine.ts'),
      src('src/screens/HeartEngine/HeartEngineScreen.tsx'),
      src('src/hooks/useHeartEngine.ts'),
    ].join('\n');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock hr', 'fake', 'score']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no cardiovascular, stress, recovery, or fitness inference in copy', () => {
    // Bare-word denials in comments document the boundary; instructional
    // patterns below are the actual violations.
    const hay = [
      src('src/screens/HeartEngine/heartEngine.ts'),
      src('src/screens/HeartEngine/HeartEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'your heart is healthy',
      'heart disease',
      'heart attack',
      'hypertension',
      'hypotension',
      'arrhythmia',
      'hr indicates stress',
      'suggests disease',
      'proves you are recovering',
      'cardiovascular fitness',
      'athletic',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for the engine', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('heart_engine'), 'no engine table');
    assert.ok(!migrations.toLowerCase().includes('heart_measurements'), 'no duplicate store');
    const screen = src('src/screens/HeartEngine/HeartEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
  });
});
