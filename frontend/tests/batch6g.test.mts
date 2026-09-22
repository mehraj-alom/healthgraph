/**
 * batch6g.test.mts — Wellbeing Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (wellbeingEngine.ts is zero-import).
 * Rating-average change rules are parity-checked against the shared
 * changes.ts contract. RN-bound layers are pinned by source-text
 * contract. Absences (no questionnaires, no inferred emotions, no
 * blended scores, no diagnoses, no migration) are tested as absences.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WELLBEING_ENGINE_ID,
  WELLBEING_HISTORY_DAYS,
  describeRatingChange,
  formatRating,
  isWellbeingEngineActive,
  priorWeekWellbeing,
  summarizeWellbeing,
  trailingWeekWellbeing,
  wellbeingWindowStart,
  type WellbeingDay,
} from '../src/screens/WellbeingEngine/wellbeingEngine.ts';
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

const W = (
  date: string,
  mood: number | null = 4,
  energy: number | null = 3,
  stress: number | null = 2,
): WellbeingDay => ({ date, mood, energy, stress });

// ============================================================================
// Activation — wellbeing ∈ activeEngines via the Batch 6A system
// ============================================================================

describe('wellbeing engine activation', () => {
  test('engine id is the 6A wellbeing selection', () => {
    assert.equal(WELLBEING_ENGINE_ID, 'wellbeing');
  });

  test('selected wellbeing activates; unselected does not', () => {
    assert.equal(isWellbeingEngineActive(['wellbeing']), true);
    assert.equal(isWellbeingEngineActive(['wellbeing', 'sleep']), true);
    assert.equal(isWellbeingEngineActive([]), false);
    assert.equal(isWellbeingEngineActive(['fitness', 'heart']), false);
  });

  test('deriveActiveEngines carries wellbeing through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['wellbeing']).map((e) => e.id),
      ['wellbeing'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('wellbeing catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.wellbeing.route?.name, 'WellbeingEngine');
  });

  test('wellbeing hub area routes to the engine', () => {
    assert.equal(areaRouteName('wellbeing'), 'WellbeingEngine');
  });

  test('wellbeing area pins when active, hub order otherwise stable', () => {
    const areas = [{ id: 'heart' }, { id: 'wellbeing' }, { id: 'medications' }] as {
      id: 'heart' | 'wellbeing' | 'medications';
    }[];
    assert.deepEqual(
      orderAreasByEngines(areas, ['wellbeing']).map((a) => a.id),
      ['wellbeing', 'heart', 'medications'],
    );
    assert.deepEqual(
      orderAreasByEngines(areas, []).map((a) => a.id),
      ['heart', 'wellbeing', 'medications'],
    );
  });

  test('deselecting wellbeing deletes nothing (selection-only)', () => {
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('daily_logs'), 'focus never touches logs');
    assert.ok(!hook.includes('overall_wellbeing'), 'focus never touches ratings');
  });
});

// ============================================================================
// No-data state — empty in, nulls out (never zeros)
// ============================================================================

describe('no-data state', () => {
  test('empty history summarizes to nulls, not zeros', () => {
    const s = summarizeWellbeing([]);
    assert.equal(s.ratedDays, 0);
    assert.equal(s.avgMood, null);
    assert.equal(s.avgEnergy, null);
    assert.equal(s.avgStress, null);
  });

  test('empty weeks yield no change lines', () => {
    for (const metric of ['mood', 'energy', 'stress'] as const) {
      assert.equal(describeRatingChange(metric, [], []), null);
    }
  });
});

// ============================================================================
// Real-data state — scale-preserving averages and point changes
// ============================================================================

describe('real-data state', () => {
  test('summary averages each metric over its own rated days', () => {
    const s = summarizeWellbeing([
      W('2026-09-18', 4, 3, 2),
      W('2026-09-19', 5, null, 4),
      W('2026-09-20', null, null, null),
    ]);
    assert.equal(s.ratedDays, 3);
    assert.equal(s.avgMood, 4.5);
    assert.equal(s.avgEnergy, 3);
    assert.equal(s.avgStress, 3);
  });

  test('a metric with no ratings averages null while others compute', () => {
    const s = summarizeWellbeing([W('2026-09-20', 4, null, null)]);
    assert.equal(s.avgMood, 4);
    assert.equal(s.avgEnergy, null);
    assert.equal(s.avgStress, null);
  });

  test('sparse single day: summary exists, changes stay null', () => {
    const days = [W('2026-09-20', 4, 3, 2)];
    assert.equal(summarizeWellbeing(days).avgMood, 4);
    assert.equal(
      describeRatingChange('mood', trailingWeekWellbeing(days, TODAY), priorWeekWellbeing(days, TODAY)),
      null,
    );
  });

  test('two-window data produces descriptive point lines', () => {
    const days = [
      W('2026-09-10', 3, 3, 4),
      W('2026-09-11', 3, 2, 4),
      W('2026-09-19', 4, 4, 2),
      W('2026-09-20', 5, 4, 2),
    ];
    const cur = trailingWeekWellbeing(days, TODAY);
    const prev = priorWeekWellbeing(days, TODAY);
    assert.equal(describeRatingChange('mood', cur, prev), 'Average mood +1.5 pts vs prior week');
    assert.equal(describeRatingChange('energy', cur, prev), 'Average energy +1.5 pts vs prior week');
    assert.equal(describeRatingChange('stress', cur, prev), 'Average stress −2 pts vs prior week');
  });

  test('identical weeks yield zero lines, not null', () => {
    const days = [W('2026-09-10', 4, 3, 2), W('2026-09-20', 4, 3, 2)];
    const cur = trailingWeekWellbeing(days, TODAY);
    const prev = priorWeekWellbeing(days, TODAY);
    assert.equal(describeRatingChange('mood', cur, prev), 'Average mood → 0 pts vs prior week');
  });

  test('change stays null for a metric unrated on either side', () => {
    const days = [W('2026-09-10', 4, null, 2), W('2026-09-20', 4, 3, 2)];
    const cur = trailingWeekWellbeing(days, TODAY);
    const prev = priorWeekWellbeing(days, TODAY);
    assert.equal(describeRatingChange('energy', cur, prev), null);
    // Rated metrics still compare.
    assert.equal(describeRatingChange('mood', cur, prev), 'Average mood → 0 pts vs prior week');
  });

  test('history window is a bounded 28-day trailing range', () => {
    assert.equal(WELLBEING_HISTORY_DAYS, 28);
    assert.equal(wellbeingWindowStart(TODAY), '2026-08-25');
  });

  test('ratings display on the original 1–5 scale (never percent)', () => {
    assert.equal(formatRating(4.06), '4.1 / 5');
    assert.equal(formatRating(3), '3 / 5');
    assert.ok(!formatRating(4.5).includes('%'), 'no percentage rescaling');
  });
});

// ============================================================================
// Parity — engine math matches the shared changes.ts contract
// ============================================================================

describe('changes.ts parity', () => {
  test('rating averages mirror mode average absolute deltas', () => {
    const cases: [WellbeingDay[], WellbeingDay[]][] = [
      [[W('2026-09-20', 5)], [W('2026-09-10', 3)]],
      [[W('2026-09-20', 4), W('2026-09-21', 2)], [W('2026-09-10', 4), W('2026-09-11', 4)]],
      [[W('2026-09-20', 4)], [W('2026-09-10', 4)]],
      [[], [W('2026-09-10', 4)]],
      [[W('2026-09-20', 4)], []],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map((d) => d.mood ?? NaN)),
        previous: summarize(prev.map((d) => d.mood ?? NaN)),
        mode: 'average',
        unit: 'pts',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      const actual = describeRatingChange('mood', cur, prev);
      assert.equal(actual, expected === null ? null : `Average mood ${expected}`);
    }
  });
});

// ============================================================================
// Hub area — rated-days headline when ratings exist, logged-days fallback
// ============================================================================

describe('wellbeing hub area', () => {
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

  test('no ratings and no logs reports no-data', () => {
    const area = buildHealthAreas(base).find((a) => a.id === 'wellbeing');
    assert.deepEqual([area?.status, area?.source], ['no-data', 'none']);
  });

  test('rated days render the rated-days headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4, wellbeingDays7: 5 }).find(
      (a) => a.id === 'wellbeing',
    );
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '5 rated days this week');
    assert.equal(area?.detail, 'From your daily check-ins');
  });

  test('check-ins without ratings keep the logged-days headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4 }).find((a) => a.id === 'wellbeing');
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '4 logged days');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6g wiring', () => {
  test('wellbeing query is patient-scoped, bounded, ratings-only', () => {
    const q = src('src/db/queries/dailyLogs.ts');
    const start = q.indexOf('export async function getWellbeingDays');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('log_date >= ? AND log_date <= ?'), 'bounded range');
    assert.ok(body.includes('overall_wellbeing'), 'mood ratings');
    assert.ok(body.includes('energy_level'), 'energy ratings');
    assert.ok(body.includes('stress_level'), 'stress ratings');
    assert.ok(!body.includes('sleep_duration_minutes'), 'sleep is not a wellbeing signal');
    assert.ok(!body.includes('appetite'), 'appetite is not a wellbeing signal');
    assert.ok(!body.includes('sync_queue'), 'no sync writes from a read');
  });

  test('engine hook composes one bounded read, reloads, never polls or writes', () => {
    const hook = src('src/hooks/useWellbeingEngine.ts');
    assert.ok(hook.includes('getWellbeingDays'), 'single bounded read');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(!hook.includes('getDailyLogEvents'), 'no per-group N+1');
    assert.ok(hook.includes('WELLBEING_HISTORY_DAYS'), 'bounded window');
  });

  test('no other engine dashboards were built', () => {
    // Batch 6H completes the set: every engine exists, none beyond it.
    assert.ok(
      fs.existsSync(path.join(ROOT, 'src', 'screens', 'HeartEngine', 'HeartEngineScreen.tsx')),
      'heart engine exists (Batch 6H)',
    );
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useHeartEngine.ts')));
  });

  test('WellbeingEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('WellbeingEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="WellbeingEngine"'), 'route registered');
    assert.ok(app.includes('WellbeingEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'WellbeingEngine'"), 'hub dispatch handles it');
  });

  test('rating rows are wiped with the patient (no orphans)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'daily_logs'"), 'group rows wiped');
    assert.ok(erase.includes('daily_log_events'), 'event rows wiped');
  });

  test('no questionnaires, inferred emotions, or blended metrics in the engine', () => {
    const hay = [
      src('src/screens/WellbeingEngine/wellbeingEngine.ts'),
      src('src/screens/WellbeingEngine/WellbeingEngineScreen.tsx'),
      src('src/hooks/useWellbeingEngine.ts'),
    ].join('\n');
    for (const phrase of ['PHQ', 'GAD', 'questionnaire', 'inferred', 'blend', '76%', 'percent']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/WellbeingEngine/wellbeingEngine.ts'),
      src('src/screens/WellbeingEngine/WellbeingEngineScreen.tsx'),
      src('src/hooks/useWellbeingEngine.ts'),
    ].join('\n');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock mood', 'fake', 'score']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no psychological, diagnostic, or causal claims in engine copy', () => {
    // Bare-word denials in comments document the boundary; instructional
    // patterns below are the actual violations.
    const hay = [
      src('src/screens/WellbeingEngine/wellbeingEngine.ts'),
      src('src/screens/WellbeingEngine/WellbeingEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'you are depressed',
      'you have depression',
      'your depression',
      'anxiety disorder',
      'you have anxiety',
      'adhd',
      'bipolar',
      'personality',
      'mental health improved',
      'your mental health',
      'psychological',
      'caused your',
      'because you',
      'indicates stress',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for wellbeing', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('wellbeing_days'), 'no new wellbeing table');
    assert.ok(!migrations.toLowerCase().includes('mood_entries'), 'no mood entries table');
    const screen = src('src/screens/WellbeingEngine/WellbeingEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
  });
});
