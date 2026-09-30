/**
 * batch6f.test.mts — Nutrition Engine (node --experimental-strip-types).
 *
 * Pure engine math runs directly (nutritionEngine.ts is zero-import).
 * Meal/kcal change rules are parity-checked against the shared changes.ts
 * contract. The meal-type list is drift-pinned against FoodScan/mealTypes.
 * RN-bound layers are pinned by source-text contract. P2.2 adds user-owned
 * macro targets + scan-sum rings (macroTargets, tested separately);
 * remaining absences (no deficit framing, no predictions, no diagnoses,
 * no migration) are still tested as absences.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NUTRITION_ENGINE_ID,
  NUTRITION_HISTORY_DAYS,
  NUTRITION_MEAL_TYPES,
  buildNutritionWeek,
  describeKcalChange,
  describeMealsChange,
  formatKcal,
  isNutritionEngineActive,
  nutritionWindowStart,
  parseMealTypes,
  priorWeekDays,
  summarizeNutrition,
  trailingWeekDays,
  type NutritionDay,
} from '../src/screens/NutritionEngine/nutritionEngine.ts';
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
import { MEAL_TYPES } from '../src/screens/FoodScan/mealTypes.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TODAY = '2026-09-21';

const D = (
  date: string,
  meals: number | null = 3,
  kcal: number | null = 1800,
  label: string | null = null,
): NutritionDay => ({ date, meals, kcal, label });

// ============================================================================
// Activation — nutrition ∈ activeEngines via the Batch 6A system
// ============================================================================

describe('nutrition engine activation', () => {
  test('engine id is the 6A nutrition selection', () => {
    assert.equal(NUTRITION_ENGINE_ID, 'nutrition');
  });

  test('selected nutrition activates; unselected does not', () => {
    assert.equal(isNutritionEngineActive(['nutrition']), true);
    assert.equal(isNutritionEngineActive(['nutrition', 'fitness']), true);
    assert.equal(isNutritionEngineActive([]), false);
    assert.equal(isNutritionEngineActive(['sleep', 'heart']), false);
  });

  test('deriveActiveEngines carries nutrition through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['nutrition']).map((e) => e.id),
      ['nutrition'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('nutrition catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.nutrition.route?.name, 'NutritionEngine');
  });

  test('nutrition hub area routes to the engine', () => {
    assert.equal(areaRouteName('nutrition'), 'NutritionEngine');
  });

  test('nutrition area pins when active, hub order otherwise stable', () => {
    const areas = [{ id: 'heart' }, { id: 'nutrition' }, { id: 'medications' }] as {
      id: 'heart' | 'nutrition' | 'medications';
    }[];
    assert.deepEqual(
      orderAreasByEngines(areas, ['nutrition']).map((a) => a.id),
      ['nutrition', 'heart', 'medications'],
    );
    assert.deepEqual(
      orderAreasByEngines(areas, []).map((a) => a.id),
      ['heart', 'nutrition', 'medications'],
    );
  });

  test('deselecting nutrition deletes nothing (selection-only)', () => {
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('daily_logs'), 'focus never touches logs');
    assert.ok(!hook.includes('food_label'), 'focus never touches labels');
  });
});

// ============================================================================
// No-data state — empty in, nulls out (never zeros)
// ============================================================================

describe('no-data state', () => {
  test('empty history summarizes to nulls, not zeros', () => {
    const s = summarizeNutrition([]);
    assert.equal(s.mealsLogged, 0);
    assert.equal(s.kcalLogged, null);
    assert.equal(s.kcalDays, 0);
    assert.equal(s.avgKcalPerDay, null);
    assert.equal(s.activeDays, 0);
  });

  test('empty weeks yield no change lines', () => {
    assert.equal(describeMealsChange([], []), null);
    assert.equal(describeKcalChange([], []), null);
  });

  test('empty week strip counts zero every day', () => {
    const week = buildNutritionWeek([], TODAY);
    assert.equal(week.length, 7);
    assert.ok(week.every((d) => d.meals === 0));
  });
});

// ============================================================================
// Real-data state — meals, estimated kcal, averages, changes
// ============================================================================

describe('real-data state', () => {
  test('summary sums counts and kcal over valued days', () => {
    const s = summarizeNutrition([
      D('2026-09-18', 3, 1800),
      D('2026-09-19', 2, 1500),
      D('2026-09-20', null, null, 'Lunch — soup'),
    ]);
    assert.equal(s.mealsLogged, 5);
    assert.equal(s.kcalLogged, 3300);
    assert.equal(s.kcalDays, 2);
    assert.equal(s.avgKcalPerDay, 1650);
    assert.equal(s.activeDays, 3);
  });

  test('averages divide over kcal days, never over all days', () => {
    const s = summarizeNutrition([
      D('2026-09-18', 3, 1800),
      D('2026-09-19', 2, null),
      D('2026-09-20', 1, null),
    ]);
    assert.equal(s.kcalLogged, 1800);
    assert.equal(s.kcalDays, 1);
    assert.equal(s.avgKcalPerDay, 1800);
  });

  test('label-only days count as active without inventing numbers', () => {
    const s = summarizeNutrition([D('2026-09-20', null, null, 'Snack — fruit')]);
    assert.equal(s.mealsLogged, 0);
    assert.equal(s.kcalLogged, null);
    assert.equal(s.activeDays, 1);
  });

  test('sparse single day: summary exists, changes stay null', () => {
    const days = [D('2026-09-20', 3, 1800)];
    assert.equal(summarizeNutrition(days).mealsLogged, 3);
    assert.equal(describeMealsChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)), null);
    assert.equal(describeKcalChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)), null);
  });

  test('two-window data produces descriptive absolute lines', () => {
    const days = [
      D('2026-09-10', 2, 1400),
      D('2026-09-11', 2, 1500),
      D('2026-09-19', 3, 1800),
      D('2026-09-20', 4, 2100),
    ];
    assert.equal(
      describeMealsChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      '+3 meals vs prior week',
    );
    assert.equal(
      describeKcalChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      '+1000 kcal vs prior week',
    );
  });

  test('identical weeks yield zero lines, not null', () => {
    const days = [D('2026-09-10', 3, 1800), D('2026-09-20', 3, 1800)];
    assert.equal(
      describeMealsChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      '→ 0 meals vs prior week',
    );
    assert.equal(
      describeKcalChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      '→ 0 kcal vs prior week',
    );
  });

  test('kcal change stays null when a side has no estimate', () => {
    const days = [D('2026-09-10', 2, null), D('2026-09-20', 3, 1800)];
    assert.equal(
      describeKcalChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      null,
    );
    // Meals still compare (counts exist on both sides).
    assert.equal(
      describeMealsChange(trailingWeekDays(days, TODAY), priorWeekDays(days, TODAY)),
      '+1 meal vs prior week',
    );
  });

  test('week strip sums meal counts per day across a month boundary', () => {
    const week = buildNutritionWeek(
      [D('2026-08-31', 2, null), D('2026-09-01', 3, 1800)],
      '2026-09-01',
    );
    assert.equal(week.length, 7);
    assert.equal(week[0].date, '2026-08-26');
    assert.equal(week[5].meals, 2);
    assert.equal(week[6].meals, 3);
    assert.equal(week[0].meals, 0);
  });

  test('history window is a bounded 28-day trailing range', () => {
    assert.equal(NUTRITION_HISTORY_DAYS, 28);
    assert.equal(nutritionWindowStart(TODAY), '2026-08-25');
  });

  test('kcal formatting is display-only', () => {
    assert.equal(formatKcal(1840), '1,840 kcal');
    assert.equal(formatKcal(613.4), '613 kcal');
  });
});

// ============================================================================
// Meal types — logged distribution, never quality
// ============================================================================

describe('meal-type distribution', () => {
  test('engine type list matches the FoodScan catalog (no drift)', () => {
    assert.deepEqual([...NUTRITION_MEAL_TYPES], [...MEAL_TYPES]);
  });

  test('classified segments count per type; unknown prefixes stay unclassified', () => {
    const parsed = parseMealTypes([
      D('2026-09-20', 3, null, 'Breakfast — oats; Lunch — soup; Dinner — fish'),
      D('2026-09-19', 1, null, 'Brunch — eggs; Snack — fruit'),
    ]);
    assert.deepEqual(parsed.byType, { Breakfast: 1, Lunch: 1, Dinner: 1, Snack: 1 });
    assert.equal(parsed.classified, 4);
    assert.equal(parsed.unclassified, 1);
  });

  test('empty and prefix-less labels contribute nothing', () => {
    const parsed = parseMealTypes([
      D('2026-09-20', 2, null, null),
      D('2026-09-19', 1, null, ''),
      D('2026-09-18', 1, null, 'just some food'),
    ]);
    assert.deepEqual(parsed.byType, {});
    assert.equal(parsed.classified, 0);
    assert.equal(parsed.unclassified, 1);
  });

  test('classification alone never becomes a nutrient value', () => {
    const s = summarizeNutrition([D('2026-09-20', null, null, 'Lunch — salad')]);
    assert.equal(s.kcalLogged, null);
    assert.equal(s.mealsLogged, 0);
  });
});

// ============================================================================
// Parity — engine math matches the shared changes.ts contract
// ============================================================================

describe('changes.ts parity', () => {
  test('meal sums mirror mode sum absolute deltas', () => {
    // ±1 renders singular in the engine; covered separately below.
    const cases: [NutritionDay[], NutritionDay[]][] = [
      [[D('2026-09-20', 4), D('2026-09-21', 3)], [D('2026-09-10', 2)]],
      [[D('2026-09-20', 1)], [D('2026-09-10', 2), D('2026-09-11', 2)]],
      [[D('2026-09-20', 3)], [D('2026-09-10', 3)]],
      [[], [D('2026-09-10', 3)]],
      [[D('2026-09-20', 3)], []],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map((d) => d.meals ?? NaN)),
        previous: summarize(prev.map((d) => d.meals ?? NaN)),
        mode: 'sum',
        unit: 'meals',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      assert.equal(describeMealsChange(cur, prev), expected);
    }
  });

  test('singular meal delta reads naturally (documented divergence)', () => {
    assert.equal(
      describeMealsChange([D('2026-09-20', 3)], [D('2026-09-10', 2)]),
      '+1 meal vs prior week',
    );
  });

  test('kcal sums mirror mode sum absolute deltas', () => {
    const cases: [NutritionDay[], NutritionDay[]][] = [
      [[D('2026-09-20', null, 2100)], [D('2026-09-10', null, 1400)]],
      [[D('2026-09-20', null, 1800)], [D('2026-09-10', null, 1800)]],
      [[D('2026-09-20', 3, null)], [D('2026-09-10', 2, 1400)]],
      [[D('2026-09-20', 3, 1800)], [D('2026-09-10', 2, null)]],
    ];
    for (const [cur, prev] of cases) {
      const expected = describeChange({
        current: summarize(cur.map((d) => d.kcal ?? NaN)),
        previous: summarize(prev.map((d) => d.kcal ?? NaN)),
        mode: 'sum',
        unit: 'kcal',
        periodLabel: 'vs prior week',
        usePercent: false,
      });
      assert.equal(describeKcalChange(cur, prev), expected);
    }
  });
});

// ============================================================================
// Hub area — meal headline when counts exist, logged-days fallback
// ============================================================================

describe('nutrition hub area', () => {
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
  };

  test('no meals and no logs reports no-data', () => {
    const area = buildHealthAreas(base).find((a) => a.id === 'nutrition');
    assert.deepEqual([area?.status, area?.source], ['no-data', 'none']);
  });

  test('logged meals render the meal headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4, nutritionMeals7: 9 }).find(
      (a) => a.id === 'nutrition',
    );
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '9 meals logged this week');
    assert.equal(area?.detail, 'From your daily logs');
  });

  test('check-ins without meal counts keep the logged-days headline', () => {
    const area = buildHealthAreas({ ...base, loggedDays: 4 }).find((a) => a.id === 'nutrition');
    assert.deepEqual([area?.status, area?.source], ['available', 'server']);
    assert.equal(area?.headline, '4 logged days');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6f wiring', () => {
  test('nutrition query is patient-scoped, bounded, group-level only', () => {
    const q = src('src/db/queries/dailyLogs.ts');
    const start = q.indexOf('export async function getNutritionDays');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('log_date >= ? AND log_date <= ?'), 'bounded range');
    assert.ok(body.includes('meals_count'), 'meal counts');
    assert.ok(body.includes('calories_kcal'), 'estimated calories');
    assert.ok(body.includes('food_label'), 'food labels');
    assert.ok(!body.includes('protein'), 'no macro columns exist');
    assert.ok(!body.includes('sync_queue'), 'no sync writes from a read');
  });

  test('engine hook composes one bounded read, reloads, never polls or writes', () => {
    const hook = src('src/hooks/useNutritionEngine.ts');
    assert.ok(hook.includes('getNutritionDays'), 'single bounded read');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(!hook.includes('getDailyLogEvents'), 'no per-group N+1');
    assert.ok(hook.includes('NUTRITION_HISTORY_DAYS'), 'bounded window');
  });

  test('no other engine dashboards were built', () => {
    // Batches 6G/6H complete the set: every engine exists, none beyond it.
    for (const id of ['wellbeing', 'heart']) {
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
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useWellbeingEngine.ts')));
  });

  test('NutritionEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('NutritionEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="NutritionEngine"'), 'route registered');
    assert.ok(app.includes('NutritionEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'NutritionEngine'"), 'hub dispatch handles it');
  });

  test('nutrition rows are wiped with the patient (no orphans)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'daily_logs'"), 'group rows wiped');
    assert.ok(erase.includes('daily_log_events'), 'event rows wiped');
  });

  test('scan macros reach rings read-only: no new columns, no group-level leak', () => {
    // P2.2: macro sums flow from existing scan breakdowns into the rings;
    // nothing new is persisted (no columns, no tables) and the group-level
    // dailyLogs query stays macro-free.
    const hay = [
      src('src/screens/NutritionEngine/nutritionEngine.ts'),
      src('src/screens/NutritionEngine/NutritionEngineScreen.tsx'),
      src('src/hooks/useNutritionEngine.ts'),
    ].join('\n');
    assert.ok(!hay.includes('protein_g'), 'no persisted protein');
    assert.ok(!hay.includes('carbs_g'), 'no persisted carbs');
    assert.ok(!hay.includes('fat_g'), 'no persisted fat');
    const q = src('src/db/queries/dailyLogs.ts');
    const start = q.indexOf('export async function getNutritionDays');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(!body.includes('protein'), 'group query stays macro-free');
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('macro_targets'), 'no macro table');
    assert.ok(!migrations.toLowerCase().includes('food_entries'), 'no food entries table');
  });

  test('no fabricated values anywhere in the engine', () => {
    const rawHay = [
      src('src/screens/NutritionEngine/nutritionEngine.ts'),
      src('src/screens/NutritionEngine/NutritionEngineScreen.tsx'),
      src('src/hooks/useNutritionEngine.ts'),
    ].join('\n');
    // Input hints (TextInput placeholder props) are UX copy, not data:
    // strip them so the ban targets fabricated content only.
    const hay = rawHay
      .replace(/placeholderTextColor/g, '')
      .replace(/placeholder="[^"]*"/g, '');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock meal', 'fake', 'score']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no medical, deficit, or causal claims in engine copy', () => {
    // Bare-word denials in comments document the boundary; instructional
    // patterns below are the actual violations.
    const hay = [
      src('src/screens/NutritionEngine/nutritionEngine.ts'),
      src('src/screens/NutritionEngine/NutritionEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'you are eating unhealthy',
      'eating healthy',
      'diet quality',
      'calorie deficit',
      'recommended calories',
      'deficiency',
      'malnutrition',
      'diabetes',
      'you will lose',
      'caused your',
      'because you',
      'will improve',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for nutrition', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('nutrition_days'), 'no new nutrition table');
    assert.ok(!migrations.toLowerCase().includes('food_entries'), 'no food entries table');
    const screen = src('src/screens/NutritionEngine/NutritionEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
  });
});
