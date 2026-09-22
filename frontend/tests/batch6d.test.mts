/**
 * batch6d.test.mts — Discipline Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (disciplineEngine.ts is zero-import).
 * Adherence/period rules are parity-checked against the shared changes.ts
 * contract. RN-bound layers (screen, hooks, queries, navigation) are pinned
 * by source-text contract. Absences (no score, no diagnosis, no graph
 * nodes, no migration) are tested as absences.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISCIPLINE_ENGINE_ID,
  DISCIPLINE_HISTORY_DAYS,
  adherenceFromStatuses,
  collectActiveDates,
  countPriorWeek,
  countTrailingWeek,
  currentActiveStreak,
  describeActiveDaysChange,
  isDisciplineEngineActive,
  isInTrailingWeek,
  localDayKeyOfInstant,
  sliceDayKey,
  trailingRangeIso,
  type DisciplineSources,
} from '../src/screens/DisciplineEngine/disciplineEngine.ts';
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
  adherencePercent,
  describeChange,
  summarize,
} from '../src/screens/HealthAreas/changes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21';

const EMPTY_SOURCES: DisciplineSources = {
  logDates: [],
  takenInstants: [],
  substanceDates: [],
  cycleDates: [],
  heartDates: [],
};

// ============================================================================
// Activation — discipline ∈ activeEngines via the Batch 6A system
// ============================================================================

describe('discipline engine activation', () => {
  test('engine id is the 6A discipline selection', () => {
    assert.equal(DISCIPLINE_ENGINE_ID, 'discipline');
  });

  test('selected discipline activates; unselected does not', () => {
    assert.equal(isDisciplineEngineActive(['discipline']), true);
    assert.equal(isDisciplineEngineActive(['discipline', 'sleep']), true);
    assert.equal(isDisciplineEngineActive([]), false);
    assert.equal(isDisciplineEngineActive(['weight', 'heart']), false);
  });

  test('deriveActiveEngines carries discipline through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['discipline']).map((e) => e.id),
      ['discipline'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('discipline catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.discipline.route?.name, 'DisciplineEngine');
  });

  test('discipline hub area routes to the engine', () => {
    assert.equal(areaRouteName('discipline'), 'DisciplineEngine');
  });

  test('discipline area pins when active, hub order otherwise stable', () => {
    const areas = [{ id: 'heart' }, { id: 'medications' }, { id: 'discipline' }] as {
      id: 'heart' | 'medications' | 'discipline';
    }[];
    assert.deepEqual(
      orderAreasByEngines(areas, ['discipline']).map((a) => a.id),
      ['discipline', 'heart', 'medications'],
    );
    assert.deepEqual(
      orderAreasByEngines(areas, []).map((a) => a.id),
      ['heart', 'medications', 'discipline'],
    );
  });

  test('deselecting discipline deletes nothing (selection-only)', () => {
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('medication_taken_events'), 'focus never touches doses');
    assert.ok(!hook.includes('daily_logs'), 'focus never touches logs');
    assert.ok(!hook.includes('profile_cache'), 'focus never touches profile');
  });
});

// ============================================================================
// Source selection — union of intentional tracked actions only
// ============================================================================

describe('active-day union', () => {
  test('empty sources yield an empty set (never a zero-filled week)', () => {
    assert.equal(collectActiveDates(EMPTY_SOURCES).size, 0);
  });

  test('each source contributes its calendar days', () => {
    // Mid-day UTC instants: identical local days for any |TZ| ≤ 12h, so
    // this test pins source-merging (not timezone conversion, tested below).
    const days = collectActiveDates({
      logDates: ['2026-09-20'],
      takenInstants: ['2026-09-19T12:00:00.000Z'],
      substanceDates: ['2026-09-18T19:30:00'],
      cycleDates: ['2026-09-17'],
      heartDates: ['2026-09-16T12:00:00.000Z'],
    });
    assert.ok(days.has('2026-09-20'), 'check-in day');
    assert.ok(days.has('2026-09-17'), 'cycle day');
    for (const d of ['2026-09-16', '2026-09-18', '2026-09-19']) {
      assert.ok(days.has(d), `action day ${d}`);
    }
  });

  test('one date counts once no matter how many actions produced it', () => {
    const days = collectActiveDates({
      logDates: ['2026-09-20', '2026-09-20'],
      takenInstants: ['2026-09-20T06:00:00.000Z', '2026-09-20T12:00:00.000Z'],
      substanceDates: [],
      cycleDates: [],
      heartDates: ['2026-09-20T12:00:00.000Z'],
    });
    assert.equal(days.size, 1);
  });

  test('malformed dates are dropped, never crash', () => {
    const days = collectActiveDates({
      logDates: ['not-a-date', ''],
      takenInstants: ['garbage'],
      substanceDates: [],
      cycleDates: [],
      heartDates: [],
    });
    assert.equal(days.size, 0);
  });

  test('dose instants use local timezone attribution', () => {
    // Attribution follows the device timezone, not the UTC string prefix:
    // the helper must agree with the Date-based local calendar day.
    const d = new Date('2026-09-19T22:30:00.000Z');
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(localDayKeyOfInstant('2026-09-19T22:30:00.000Z'), expected);
    assert.match(expected, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(localDayKeyOfInstant('garbage'), null);
  });

  test('wall-time strings slice by contract', () => {
    assert.equal(sliceDayKey('2026-09-18T19:30:00'), '2026-09-18');
    assert.equal(sliceDayKey('2026-09-17'), '2026-09-17');
    assert.equal(sliceDayKey('nope'), null);
  });
});

// ============================================================================
// Current week, prior week, date boundaries
// ============================================================================

describe('week windows', () => {
  test('trailing week counts days 0–6 back across a month boundary', () => {
    // Today 09-01: trailing week is 08-26…09-01, prior week 08-19…08-25.
    const days = new Set(['2026-08-27', '2026-08-31', '2026-09-01']);
    assert.equal(countTrailingWeek(days, '2026-09-01'), 3);
    assert.equal(countPriorWeek(days, '2026-09-01'), 0);
  });

  test('sparse single day: current counts, prior is zero, line stays factual', () => {
    const days = new Set(['2026-09-20']);
    assert.equal(countTrailingWeek(days, TODAY), 1);
    assert.equal(countPriorWeek(days, TODAY), 0);
    assert.equal(
      describeActiveDaysChange(1, 0),
      'Active 1 of 7 days · +1 vs prior week',
    );
  });

  test('empty history: zeros compare factually, never null-crashes', () => {
    assert.equal(countTrailingWeek(new Set(), TODAY), 0);
    assert.equal(
      describeActiveDaysChange(0, 0),
      'Active 0 of 7 days · → 0 vs prior week',
    );
  });

  test('history window is a bounded 14-day trailing range', () => {
    assert.equal(DISCIPLINE_HISTORY_DAYS, 14);
    const [start, end] = trailingRangeIso(TODAY, 14);
    assert.ok(start < end);
    // Start is local midnight 13 days back (asserted in local terms —
    // the UTC slice shifts with device timezone by design).
    assert.equal(localDayKeyOfInstant(start), '2026-09-08');
  });

  test('isInTrailingWeek bounds the 7-day slice', () => {
    assert.equal(isInTrailingWeek('2026-09-21', TODAY), true);
    assert.equal(isInTrailingWeek('2026-09-15', TODAY), true);
    assert.equal(isInTrailingWeek('2026-09-14', TODAY), false);
    assert.equal(isInTrailingWeek('2026-09-22', TODAY), false);
  });
});

// ============================================================================
// Streak — consecutive active days, gaps break, missing ≠ continuation
// ============================================================================

describe('active-day streak', () => {
  test('consecutive run through today counts fully', () => {
    const days = new Set(['2026-09-19', '2026-09-20', '2026-09-21']);
    assert.equal(currentActiveStreak(days, TODAY), 3);
  });

  test('today without action yet keeps yesterday-ended streak alive', () => {
    const days = new Set(['2026-09-19', '2026-09-20']);
    assert.equal(currentActiveStreak(days, TODAY), 2);
  });

  test('a gap day ends the streak (no fabricated continuity)', () => {
    const days = new Set(['2026-09-15', '2026-09-16', '2026-09-21']);
    assert.equal(currentActiveStreak(days, TODAY), 1);
  });

  test('empty history streaks zero', () => {
    assert.equal(currentActiveStreak(new Set(), TODAY), 0);
  });
});

// ============================================================================
// Adherence — TAKEN over TAKEN+MISSED+SKIPPED, LATE excluded, parity-tested
// ============================================================================

describe('medication adherence', () => {
  test('percentage with explicit numerator and denominator', () => {
    assert.deepEqual(adherenceFromStatuses(['TAKEN', 'TAKEN', 'MISSED', 'SKIPPED']), {
      taken: 2,
      total: 4,
      percent: 50,
    });
  });

  test('LATE is excluded from both sides', () => {
    assert.deepEqual(adherenceFromStatuses(['TAKEN', 'LATE']), {
      taken: 1,
      total: 1,
      percent: 100,
    });
  });

  test('zero denominator stays null (never 0%)', () => {
    assert.equal(adherenceFromStatuses([]), null);
    assert.equal(adherenceFromStatuses(['LATE']), null);
    assert.equal(adherenceFromStatuses(['UNKNOWN' as never]), null);
  });

  test('adherence matches the shared changes.ts contract (parity)', () => {
    const fixtures: string[][] = [
      [],
      ['TAKEN'],
      ['TAKEN', 'TAKEN', 'MISSED', 'SKIPPED'],
      ['TAKEN', 'LATE'],
      ['LATE'],
      ['MISSED', 'MISSED', 'SKIPPED'],
    ];
    for (const statuses of fixtures) {
      const expected = adherencePercent(statuses);
      const actual = adherenceFromStatuses(statuses);
      if (expected === null) {
        assert.equal(actual, null, statuses.join(','));
      } else {
        const pct = Number(expected.text.split('%')[0].split(' ').at(-1));
        assert.equal(actual?.percent, pct, statuses.join(','));
        assert.ok((actual?.total ?? 0) > 0, statuses.join(','));
      }
    }
  });

  test('change line mirrors the absolute-delta rule (parity)', () => {
    for (const [cur, prev] of [[5, 3], [3, 5], [4, 4], [1, 0]] as const) {
      const expected = describeChange({
        current: summarize(Array(cur).fill(1)),
        previous: summarize(Array(prev).fill(1)),
        mode: 'count',
        unit: 'days',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      const line = describeActiveDaysChange(cur, prev);
      if (cur === prev) {
        assert.ok(line.includes('→ 0'), `${cur}/${prev}`);
        assert.ok(expected?.includes('→ 0') ?? false, `${cur}/${prev}`);
      } else {
        const sign = cur > prev ? '+' : '−';
        assert.ok(line.includes(`${sign}${Math.abs(cur - prev)}`), `${cur}/${prev}`);
        // Zero-baseline count deltas: changes.ts requires a baseline row
        // (null), while the engine still reports the absolute count delta —
        // both honest, documented divergence for counts (never percentages).
        if (prev > 0) {
          assert.ok(expected?.includes(`${sign}${Math.abs(cur - prev)}`) ?? false, `${cur}/${prev}`);
        } else {
          assert.equal(expected, null, `${cur}/${prev}`);
        }
      }
    }
  });
});

// ============================================================================
// Hub area — available only with real active days
// ============================================================================

describe('discipline hub area', () => {
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
  };

  test('no active days reports no-data (never a placeholder)', () => {
    const area = buildHealthAreas(base).find((a) => a.id === 'discipline');
    assert.deepEqual([area?.status, area?.source], ['no-data', 'none']);
  });

  test('real active days render the factual headline', () => {
    const area = buildHealthAreas({ ...base, activeDays7: 5 }).find(
      (a) => a.id === 'discipline',
    );
    assert.deepEqual([area?.status, area?.source], ['available', 'device']);
    assert.equal(area?.headline, 'Active 5 of 7 days');
    assert.equal(area?.detail, 'From your tracked actions');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6d wiring', () => {
  test('dose range query is patient-scoped and bounded', () => {
    const q = src('src/db/queries/medicationTakenEvents.ts');
    const start = q.indexOf('export async function getTakenEventsInRange');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('taken_at >= ? AND taken_at < ?'), 'bounded range');
    assert.ok(!body.includes('sync_queue'), 'no sync writes from a read');
  });

  test('engine hook composes bounded reads, reloads, never polls or writes', () => {
    const hook = src('src/hooks/useDisciplineEngine.ts');
    assert.ok(hook.includes('getTakenEventsInRange'), 'range read');
    assert.ok(hook.includes('getDailyLogs'), 'check-in read');
    assert.ok(hook.includes('listSubstanceEntries'), 'substance read');
    assert.ok(hook.includes('listCycleEntries'), 'cycle read');
    assert.ok(hook.includes('getRecentLocalHeartRates'), 'measurement read');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(!hook.includes('getMedicationTakenEventsForDate'), 'no per-day N+1');
    assert.ok(hook.includes('DISCIPLINE_HISTORY_DAYS'), 'bounded window');
  });

  test('hub hook shares the engine contract (no divergent math)', () => {
    const hub = src('src/hooks/useHealthAreas.ts');
    assert.ok(hub.includes('collectActiveDates'), 'shared union');
    assert.ok(hub.includes('countTrailingWeek'), 'shared count');
    assert.ok(hub.includes('getTakenEventsInRange'), 'bounded dose read');
  });

  test('no other engine dashboards were built', () => {
    // Batches 6E–6H complete the set: every engine exists, none beyond it.
    for (const id of ['fitness', 'nutrition', 'wellbeing', 'heart']) {
      if (id === 'fitness') {
        assert.ok(
          fs.existsSync(path.join(ROOT, 'src', 'screens', 'FitnessEngine', 'FitnessEngineScreen.tsx')),
          'fitness engine exists (Batch 6E)',
        );
        continue;
      }
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
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useFitnessEngine.ts')));
  });

  test('DisciplineEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('DisciplineEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="DisciplineEngine"'), 'route registered');
    assert.ok(app.includes('DisciplineEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'DisciplineEngine'"), 'hub dispatch handles it');
  });

  test('engine sources are wiped with the patient (no orphans)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    for (const table of [
      'medication_taken_events',
      'daily_logs',
      'substance_entries',
      'cycle_entries',
      'ppg_measurements',
      'rppg_measurements',
    ]) {
      assert.ok(erase.includes(`'${table}'`), `${table} wiped`);
    }
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/DisciplineEngine/disciplineEngine.ts'),
      src('src/screens/DisciplineEngine/DisciplineEngineScreen.tsx'),
      src('src/hooks/useDisciplineEngine.ts'),
    ].join('\n');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock adher', 'fake', 'score']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no personality, mental-health, or causal claims in engine copy', () => {
    // Bare-word denials in comments document the boundary; instructional
    // patterns below are the actual violations.
    const hay = [
      src('src/screens/DisciplineEngine/disciplineEngine.ts'),
      src('src/screens/DisciplineEngine/DisciplineEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'you are disciplined',
      'you became more disciplined',
      'your discipline increased',
      'you are improving',
      'lazy',
      'adhd',
      'depress',
      'anxiet',
      'personality',
      'disorder',
      'because you',
      'caused by',
      'caused your',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no discipline nodes, no migration, no backend endpoint', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('discipline'), 'no discipline table');
    const screen = src('src/screens/DisciplineEngine/DisciplineEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
    const graph = src('src/screens/Body/HealthGraphScreen.tsx');
    assert.ok(!graph.toLowerCase().includes('discipline'), 'no graph nodes');
  });
});
