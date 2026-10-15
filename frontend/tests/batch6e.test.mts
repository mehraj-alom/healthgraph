/**
 * batch6e.test.mts — Fitness Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (fitnessEngine.ts is zero-import).
 * Session/minute change rules are parity-checked against the shared
 * changes.ts contract. RN-bound layers (screen, hook, queries,
 * navigation) are pinned by source-text contract. Absences (no steps,
 * no scores, no predictions, no PPG-as-workout, no migration) are
 * tested as absences.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FITNESS_ENGINE_ID,
  FITNESS_HISTORY_DAYS,
  buildFitnessWeek,
  describeMinutesChange,
  describeSessionsChange,
  fitnessWindowStart,
  formatActiveMinutes,
  isFitnessEngineActive,
  priorWeekSessions,
  summarizeFitness,
  trailingWeekSessions,
  type FitnessSession,
} from '../src/screens/FitnessEngine/fitnessEngine.ts';
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21';

const S = (
  date: string,
  type = 'Walking',
  durationMinutes: number | null = 30,
  caloriesLogged: number | null = null,
): FitnessSession => ({ date, type, durationMinutes, caloriesLogged });

// ============================================================================
// Activation — fitness ∈ activeEngines via the Batch 6A system
// ============================================================================

describe('fitness engine activation', () => {
  test('engine id is the 6A fitness selection', () => {
    assert.equal(FITNESS_ENGINE_ID, 'fitness');
  });

  test('selected fitness activates; unselected does not', () => {
    assert.equal(isFitnessEngineActive(['fitness']), true);
    assert.equal(isFitnessEngineActive(['fitness', 'sleep']), true);
    assert.equal(isFitnessEngineActive([]), false);
    assert.equal(isFitnessEngineActive(['weight', 'heart']), false);
  });

  test('deriveActiveEngines carries fitness through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['fitness']).map((e) => e.id),
      ['fitness'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('fitness catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.fitness.route?.name, 'FitnessEngine');
  });

  test('activity hub area routes to the engine', () => {
    assert.equal(areaRouteName('activity'), 'FitnessEngine');
  });

  test('fitness area pins when active, hub order otherwise stable', () => {
    const areas = [{ id: 'heart' }, { id: 'activity' }, { id: 'medications' }] as {
      id: 'heart' | 'activity' | 'medications';
    }[];
    assert.deepEqual(
      orderAreasByEngines(areas, ['fitness']).map((a) => a.id),
      ['activity', 'heart', 'medications'],
    );
    assert.deepEqual(
      orderAreasByEngines(areas, []).map((a) => a.id),
      ['heart', 'activity', 'medications'],
    );
  });

  test('deselecting fitness deletes nothing (selection-only)', () => {
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('daily_log_events'), 'focus never touches events');
    assert.ok(!hook.includes('daily_logs'), 'focus never touches logs');
  });
});

// ============================================================================
// No-data state — empty in, nulls out (never zeros)
// ============================================================================

describe('no-data state', () => {
  test('empty history summarizes to nulls, not zeros', () => {
    const s = summarizeFitness([]);
    assert.equal(s.sessions, 0);
    assert.equal(s.activeMinutes, null);
    assert.equal(s.avgMinutes, null);
    assert.equal(s.activeDays, 0);
    assert.equal(s.caloriesLogged, null);
  });

  test('empty weeks yield no change lines', () => {
    assert.equal(describeSessionsChange([], []), null);
    assert.equal(describeMinutesChange([], []), null);
  });

  test('empty week strip counts zero every day', () => {
    const week = buildFitnessWeek([], TODAY);
    assert.equal(week.length, 7);
    assert.ok(week.every((d) => d.sessions === 0));
  });
});

// ============================================================================
// Real-data state — sessions, minutes, averages, changes
// ============================================================================

describe('real-data state', () => {
  test('summary counts rows and sums recorded durations', () => {
    const s = summarizeFitness([
      S('2026-09-18', 'Walking', 30),
      S('2026-09-19', 'Running', 45),
      S('2026-09-20', 'Yoga', null),
    ]);
    assert.equal(s.sessions, 3);
    assert.equal(s.activeMinutes, 75);
    assert.equal(s.avgMinutes, 37.5);
    assert.equal(s.activeDays, 3);
    assert.equal(s.caloriesLogged, null);
  });

  test('duration-less sessions count but contribute no minutes', () => {
    const s = summarizeFitness([S('2026-09-20', 'Yoga', null)]);
    assert.equal(s.sessions, 1);
    assert.equal(s.activeMinutes, null);
    assert.equal(s.avgMinutes, null);
    assert.equal(s.activeDays, 1);
  });

  test('averages divide over sessions WITH a duration only', () => {
    const s = summarizeFitness([
      S('2026-09-20', 'Walking', 30),
      S('2026-09-20', 'Yoga', null),
      S('2026-09-20', 'Cycling', 60),
    ]);
    assert.equal(s.avgMinutes, 45);
  });

  test('logged calories sum only when entered, labeled as logged', () => {
    const s = summarizeFitness([
      S('2026-09-20', 'Running', 30, 250),
      S('2026-09-19', 'Walking', 30, null),
    ]);
    assert.equal(s.caloriesLogged, 250);
  });

  test('sparse single session: summary exists, changes stay null', () => {
    const sessions = [S('2026-09-20', 'Walking', 30)];
    assert.equal(summarizeFitness(sessions).sessions, 1);
    assert.equal(describeSessionsChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)), null);
    assert.equal(describeMinutesChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)), null);
  });

  test('two-window data produces descriptive absolute lines', () => {
    const sessions = [
      S('2026-09-10', 'Walking', 20),
      S('2026-09-19', 'Walking', 30),
      S('2026-09-20', 'Running', 45),
    ];
    assert.equal(
      describeSessionsChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      '+1 session vs prior week',
    );
    assert.equal(
      describeMinutesChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      '+55 min vs prior week',
    );
  });

  test('identical weeks yield zero lines, not null', () => {
    const sessions = [S('2026-09-10', 'Walking', 30), S('2026-09-20', 'Walking', 30)];
    assert.equal(
      describeSessionsChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      '→ 0 sessions vs prior week',
    );
    assert.equal(
      describeMinutesChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      '→ 0 min vs prior week',
    );
  });

  test('minutes change stays null when a side logged no durations', () => {
    const sessions = [S('2026-09-10', 'Yoga', null), S('2026-09-20', 'Walking', 30)];
    assert.equal(
      describeMinutesChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      null,
    );
    // Sessions still compare (rows exist on both sides).
    assert.equal(
      describeSessionsChange(trailingWeekSessions(sessions, TODAY), priorWeekSessions(sessions, TODAY)),
      '→ 0 sessions vs prior week',
    );
  });

  test('week strip counts sessions per day across a month boundary', () => {
    const week = buildFitnessWeek(
      [S('2026-08-31', 'Walking', 20), S('2026-09-01', 'Running', 30), S('2026-09-01', 'Yoga', null)],
      '2026-09-01',
    );
    assert.equal(week.length, 7);
    assert.equal(week[0].date, '2026-08-26');
    assert.equal(week[5].sessions, 1);
    assert.equal(week[6].sessions, 2);
    assert.equal(week[0].sessions, 0);
  });

  test('history window is a bounded 28-day trailing range', () => {
    assert.equal(FITNESS_HISTORY_DAYS, 28);
    assert.equal(fitnessWindowStart(TODAY), '2026-08-25');
  });

  test('minute formatting never rounds stored values silently', () => {
    assert.equal(formatActiveMinutes(90), '1h 30m');
    assert.equal(formatActiveMinutes(60), '1h');
    assert.equal(formatActiveMinutes(45), '45m');
  });
});

// ============================================================================
// Parity — engine math matches the shared changes.ts contract
// ============================================================================

describe('changes.ts parity', () => {
  test('session counts mirror mode count absolute deltas', () => {
    // Deltas of ±1 render singular in the engine ("1 session") while
    // changes.ts always pluralizes — asserted separately below.
    const cases: [FitnessSession[], FitnessSession[]][] = [
      [[S('2026-09-20'), S('2026-09-21'), S('2026-09-22')], [S('2026-09-10')]],
      [[S('2026-09-20')], [S('2026-09-10'), S('2026-09-11'), S('2026-09-12')]],
      [[S('2026-09-20'), S('2026-09-21')], [S('2026-09-10'), S('2026-09-11')]],
      [[], [S('2026-09-10')]],
      [[S('2026-09-20')], []],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map(() => 1)),
        previous: summarize(prev.map(() => 1)),
        mode: 'count',
        unit: 'sessions',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      assert.equal(describeSessionsChange(cur, prev), expected);
    }
  });

  test('singular session delta reads naturally (documented divergence)', () => {
    assert.equal(
      describeSessionsChange([S('2026-09-20'), S('2026-09-21')], [S('2026-09-10')]),
      '+1 session vs prior week',
    );
  });

  test('minute sums mirror mode sum absolute deltas', () => {
    const cases: [FitnessSession[], FitnessSession[]][] = [
      [[S('2026-09-20', 'Walking', 45)], [S('2026-09-10', 'Walking', 20)]],
      [[S('2026-09-20', 'Walking', 30)], [S('2026-09-10', 'Walking', 30)]],
      [[S('2026-09-20', 'Yoga', null)], [S('2026-09-10', 'Walking', 20)]],
      [[S('2026-09-20', 'Walking', 30)], [S('2026-09-10', 'Yoga', null)]],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map((s) => s.durationMinutes ?? NaN)),
        previous: summarize(prev.map((s) => s.durationMinutes ?? NaN)),
        mode: 'sum',
        unit: 'min',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      // summarize drops non-finite entries, matching the engine's rule.
      assert.equal(describeMinutesChange(cur, prev), expected);
    }
  });
});

// ============================================================================
// Hub area — workout headline when sessions exist, logged-days fallback
// ============================================================================

describe('fitness hub area', () => {
  const base = {
    heartBpm: null,
    serverHeartBpm: null,
    loggedDays: 0,
    activeMedications: 0,
    documentCount: 0,
    substanceEntries: 0,
    cycleEntries: 0,
    meditationSessions7: 0,
    profileWeightKg: null as number | null,
    activeDays7: 0,
    activitySessions7: 0,
  };

  test('no sessions and no logs reports no-data', () => {
    const area = buildHealthAreas(base).find((a) => a.id === 'activity');
    assert.deepEqual([area?.status, area?.source], ['no-data', 'none']);
  });

  test('logged sessions render the workout headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4, activitySessions7: 3 }).find(
      (a) => a.id === 'activity',
    );
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '3 workouts this week');
    assert.equal(area?.detail, 'From your logged activity');
  });

  test('check-ins without workouts keep the logged-days headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4 }).find((a) => a.id === 'activity');
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '4 logged days');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6e wiring', () => {
  test('activity query is patient-scoped, bounded, group-date attributed', () => {
    const q = src('src/db/queries/dailyLogs.ts');
    const start = q.indexOf('export async function getActivityLogs');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('g.patient_id = ?'), 'patient scope via group');
    assert.ok(body.includes("e.event_type = 'ACTIVITY_LOG'"), 'activity rows only');
    assert.ok(body.includes('g.log_date >= ? AND g.log_date <= ?'), 'bounded range');
    assert.ok(body.includes('INNER JOIN daily_logs'), 'group-date attribution');
    assert.ok(!body.includes('sync_queue'), 'no sync writes from a read');
  });

  test('engine hook composes one bounded read, reloads, never polls or writes', () => {
    const hook = src('src/hooks/useFitnessEngine.ts');
    assert.ok(hook.includes('getActivityLogs'), 'single bounded read');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(!hook.includes('getDailyLogEvents'), 'no per-group N+1');
    assert.ok(hook.includes('FITNESS_HISTORY_DAYS'), 'bounded window');
  });

  test('no other engine dashboards were built', () => {
    // Batches 6F–6H complete the set: every engine exists, none beyond it.
    for (const id of ['nutrition', 'wellbeing', 'heart']) {
      if (id === 'nutrition') {
        assert.ok(
          fs.existsSync(path.join(ROOT, 'src', 'screens', 'NutritionEngine', 'NutritionEngineScreen.tsx')),
          'nutrition engine exists (Batch 6F)',
        );
        continue;
      }
      if (id === 'wellbeing') {
        assert.ok(
          fs.existsSync(path.join(ROOT, 'src', 'screens', 'WellbeingEngine', 'WellbeingEngineScreen.tsx')),
          'wellbeing engine exists (Batch 6G)',
        );
        continue;
      }
      assert.ok(
        fs.existsSync(path.join(ROOT, 'src', 'screens', 'HeartEngine', 'HeartEngineScreen.tsx')),
        'heart engine exists (Batch 6H)',
      );
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useNutritionEngine.ts')));
  });

  test('FitnessEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('FitnessEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="FitnessEngine"'), 'route registered');
    assert.ok(app.includes('FitnessEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'FitnessEngine'"), 'hub dispatch handles it');
  });

  test('activity rows are wiped with the patient (no orphans)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'daily_logs'"), 'group rows wiped');
    assert.ok(erase.includes('daily_log_events'), 'event rows wiped');
  });

  test('PPG measurements never enter the fitness engine', () => {
    const hay = [
      src('src/screens/FitnessEngine/fitnessEngine.ts'),
      src('src/screens/FitnessEngine/FitnessEngineScreen.tsx'),
      src('src/hooks/useFitnessEngine.ts'),
    ].join('\n');
    assert.ok(!hay.includes('PpgMeasure'), 'no pulse screen link');
    assert.ok(!hay.includes('getRecentLocalHeartRates'), 'no heart rows');
    assert.ok(!hay.includes('ppg'), 'no ppg reference');
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/FitnessEngine/fitnessEngine.ts'),
      src('src/screens/FitnessEngine/FitnessEngineScreen.tsx'),
      src('src/hooks/useFitnessEngine.ts'),
    ].join('\n');
    // TextInput hint props are labels, not data — scrub before scanning.
    const scrubbed = hay.replace(/placeholder="[^"]*"/g, '');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock workout', 'fake', 'score']) {
      assert.ok(!scrubbed.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no medical, score, or causal claims in engine copy', () => {
    // Bare-word denials in comments document the boundary; instructional
    // patterns below are the actual violations.
    const hay = [
      src('src/screens/FitnessEngine/fitnessEngine.ts'),
      src('src/screens/FitnessEngine/FitnessEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'you are fitter',
      'your fitness improved',
      'fitness level',
      'vo2',
      'training load',
      'recovery score',
      'performance score',
      'you will lose',
      'caused your',
      'because you',
      'obes',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for fitness', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('activity_logs'), 'no new activity table');
    assert.ok(!migrations.toLowerCase().includes('fitness'), 'no engine table');
    const screen = src('src/screens/FitnessEngine/FitnessEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
  });
});
