/**
 * macroTargets.test.mts — user-owned macro targets (node --experimental-strip-types).
 *
 * Pure math runs directly (macroTargets.ts is zero-import). RN-bound layers
 * (store shape, range-sum SQL, screen wiring) are pinned by source-text
 * contract. Copy boundaries from batch6f still hold: no deficit framing,
 * no predictions, no diagnoses, no rated numbers, no network from the UI.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVITY_FACTOR,
  isOnTargetDay,
  nutrientProgress,
  suggestTargets,
  weekOnTarget,
  type DayMacros,
} from '../src/screens/NutritionEngine/macroTargets.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('suggestTargets', () => {
  test('full profile uses Mifflin-St Jeor with goal adjustment', () => {
    // Male, 80kg, 180cm, 30y, moderate: BMR=1780, TDEE=2759.
    const s = suggestTargets({
      weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male',
      goal: 'maintain', activity: 'moderate',
    });
    assert.equal(s.calories, 2760);
    assert.equal(s.protein, 144); // 1.8 * 80
    assert.ok((s.fat as number) > 0 && (s.carbs as number) > 0);
    // Macro calories roughly cover the calorie target (rounding slack).
    const macroKcal = (s.protein as number) * 4 + (s.carbs as number) * 4 + (s.fat as number) * 9;
    assert.ok(Math.abs(macroKcal - (s.calories as number)) < 12);
  });

  test('lose subtracts 500 with a 1400 floor; gain adds 300', () => {
    const base = { weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' as const, activity: 'moderate' as const };
    const lose = suggestTargets({ ...base, goal: 'lose' });
    const maintain = suggestTargets({ ...base, goal: 'maintain' });
    const gain = suggestTargets({ ...base, goal: 'gain' });
    assert.equal((maintain.calories as number) - (lose.calories as number), 500);
    assert.equal((gain.calories as number) - (maintain.calories as number), 300);
    const tiny = suggestTargets({ weightKg: 45, heightCm: 150, ageYears: 60, sex: 'female', goal: 'lose', activity: 'light' });
    assert.ok((tiny.calories as number) >= 1400);
  });

  test('missing age/sex falls back to weight-based estimate; missing weight yields nulls', () => {
    const s = suggestTargets({ weightKg: 70, heightCm: null, ageYears: null, sex: null, goal: 'maintain', activity: 'moderate' });
    assert.ok((s.calories as number) > 0 && (s.protein as number) > 0);
    const n = suggestTargets({ weightKg: null, heightCm: 170, ageYears: 30, sex: 'female', goal: 'maintain', activity: 'moderate' });
    assert.deepEqual(n, { calories: null, protein: null, carbs: null, fat: null });
  });

  test('protein scales with goal direction', () => {
    const base = { weightKg: 70, heightCm: null, ageYears: null, sex: null, activity: 'moderate' as const };
    assert.ok((suggestTargets({ ...base, goal: 'lose' }).protein as number) >= (suggestTargets({ ...base, goal: 'maintain' }).protein as number));
    assert.ok((suggestTargets({ ...base, goal: 'maintain' }).protein as number) >= (suggestTargets({ ...base, goal: 'gain' }).protein as number));
  });

  test('activity bands are ordered multipliers', () => {
    const f = ACTIVITY_FACTOR;
    assert.ok(f.light < f.moderate && f.moderate < f.active && f.active < f['very-active']);
  });
});

describe('progress + on-target', () => {
  test('nutrientProgress ratios and guards', () => {
    assert.deepEqual(nutrientProgress(1800, 2200), { actual: 1800, target: 2200, ratio: 1800 / 2200, remaining: 400 });
    assert.equal(nutrientProgress(null, 2200), null);
    assert.equal(nutrientProgress(1800, null), null);
    assert.equal(nutrientProgress(1800, 0), null);
    assert.equal(nutrientProgress(-5, 2200), null);
  });

  test('on-target band is ±15%', () => {
    assert.equal(isOnTargetDay({ kcal: 2200 }, 2200), true);
    assert.equal(isOnTargetDay({ kcal: 2530 }, 2200), true); // +15%
    assert.equal(isOnTargetDay({ kcal: 2531 }, 2200), false);
    assert.equal(isOnTargetDay({ kcal: 1870 }, 2200), true); // -15%
    assert.equal(isOnTargetDay({ kcal: 1869 }, 2200), false);
    assert.equal(isOnTargetDay({ kcal: 2200 }, null), false);
  });

  test('weekOnTarget counts days with data only', () => {
    const days: Pick<DayMacros, 'date' | 'kcal'>[] = [
      { date: '2026-09-20', kcal: 2200 },
      { date: '2026-09-21', kcal: 3000 },
      { date: '2026-09-22', kcal: 0 },
    ];
    assert.deepEqual(weekOnTarget(days, 2200), { onTarget: 1, withData: 2 });
    assert.equal(weekOnTarget([], 2200), null);
    assert.equal(weekOnTarget(days, null), null);
  });
});

describe('macro wiring', () => {
  test('range sums are patient-scoped and bounded', () => {
    const q = src('src/db/queries/foodScans.ts');
    const start = q.indexOf('export async function sumMacroRangeDb');
    assert.ok(start !== -1, 'range-sum entry point exists');
    const body = q.slice(start, start + 2000);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('log_date >= ? AND log_date <= ?'), 'bounded range');
    assert.ok(body.includes('food_scan_items'), 'scan breakdown source');
  });

  test('targets persist device-only via AsyncStorage (no network, no table)', () => {
    const store = src('src/services/macroTargetStore.ts');
    assert.ok(store.includes('AsyncStorage'), 'device storage');
    assert.ok(!store.includes('fetch('), 'no network');
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('macro_targets'), 'no new table');
  });

  test('screen renders rings from scan sums, never deficit copy', () => {
    const screen = src('src/screens/NutritionEngine/NutritionEngineScreen.tsx');
    assert.ok(screen.includes('sumMacroRange') || screen.includes('todayMacros'), 'scan sums feed rings');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    const lower = screen.toLowerCase();
    for (const phrase of ['calorie deficit', 'deficit', 'you will lose', 'recommended']) {
      assert.ok(!lower.includes(phrase), phrase);
    }
  });

  test('hook loads one bounded macro range plus stored targets', () => {
    const hook = src('src/hooks/useNutritionEngine.ts');
    assert.ok(hook.includes('sumMacroRange'), 'macro range read');
    assert.ok(hook.includes('loadMacroTargets'), 'stored targets');
    assert.ok(!hook.includes('setInterval'), 'no polling');
  });
});
