/**
 * batch6c.test.mts — Weight Management Engine (node --experimental-strip-types).
 *
 * The audit found exactly one real weight source (profile_cache.weight_kg),
 * so the engine is a shell: pure display-model math runs directly
 * (weightEngine.ts is zero-import); change/trend/period behavior is pinned
 * by ABSENCE (a single profile value has no baseline — computing a change
 * would be fabrication). RN-bound layers are pinned by source-text contract.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WEIGHT_ENGINE_ID,
  buildWeightEngineModel,
  formatWeightKg,
  isWeightEngineActive,
  sanitizeProfileWeight,
} from '../src/screens/WeightEngine/weightEngine.ts';
import {
  deriveActiveEngines,
  ENGINES,
} from '../src/screens/HealthAreas/engines.ts';
import {
  areaRouteName,
  buildHealthAreas,
} from '../src/screens/HealthAreas/areas.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ============================================================================
// Activation — weight ∈ activeEngines via the Batch 6A system (no new state)
// ============================================================================

describe('weight engine activation', () => {
  test('engine id is the 6A weight selection', () => {
    assert.equal(WEIGHT_ENGINE_ID, 'weight');
  });

  test('selected weight activates; unselected does not', () => {
    assert.equal(isWeightEngineActive(['weight']), true);
    assert.equal(isWeightEngineActive(['weight', 'sleep']), true);
    assert.equal(isWeightEngineActive([]), false);
    assert.equal(isWeightEngineActive(['sleep', 'heart']), false);
  });

  test('deriveActiveEngines carries weight through the 6A pipeline', () => {
    assert.deepEqual(
      deriveActiveEngines(['weight']).map((e) => e.id),
      ['weight'],
    );
    assert.deepEqual(deriveActiveEngines([]).map((e) => e.id), []);
  });

  test('weight catalog entry points at the engine destination', () => {
    assert.equal(ENGINES.weight.route?.name, 'WeightEngine');
  });

  test('weight hub area routes to the engine', () => {
    assert.equal(areaRouteName('weight'), 'WeightEngine');
  });

  test('changing focus never deletes weight history (selection-only)', () => {
    // Focus is a string list in onboarding_state; the engine reads the
    // profile cache. Nothing in the deselection path touches either store.
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(!hook.includes('weight_kg'), 'focus writes never touch weight');
    assert.ok(!hook.includes('profile_cache'), 'focus writes never touch profile');
  });
});

// ============================================================================
// Real-data state — profile weight display model
// ============================================================================

describe('profile weight model', () => {
  test('real value passes through with profile provenance', () => {
    assert.deepEqual(buildWeightEngineModel(72.5), {
      weightKg: 72.5,
      provenance: 'From your profile',
    });
  });

  test('absent profile weight is null (empty state, never zero)', () => {
    assert.equal(buildWeightEngineModel(null).weightKg, null);
    assert.equal(buildWeightEngineModel(undefined).weightKg, null);
  });

  test('non-finite and impossible values refuse (never render as data)', () => {
    for (const bad of [0, -3, NaN, Infinity, 500, 999, '72.5', {}, []]) {
      assert.equal(sanitizeProfileWeight(bad), null, String(bad));
    }
    assert.equal(sanitizeProfileWeight(72.5), 72.5);
    assert.equal(sanitizeProfileWeight(150), 150);
  });

  test('formatting is display-only', () => {
    assert.equal(formatWeightKg(72.5), '72.5 kg');
    assert.equal(formatWeightKg(72), '72 kg');
    assert.equal(formatWeightKg(72.04), '72 kg');
  });

  test('hub weight area reflects the profile value honestly', () => {
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
    };
    const empty = buildHealthAreas(base).find((a) => a.id === 'weight');
    assert.deepEqual([empty?.status, empty?.source], ['no-data', 'none']);
    const filled = buildHealthAreas({ ...base, profileWeightKg: 72.5 }).find(
      (a) => a.id === 'weight',
    );
    assert.deepEqual([filled?.status, filled?.source], ['available', 'server']);
    assert.ok(filled?.headline.includes('72.5'), 'real value shown');
    assert.ok(filled?.headline.includes('kg'), 'unit shown');
    assert.equal(filled?.detail, 'From your profile');
  });
});

// ============================================================================
// Honest refusals — no series, no change, no periods from a single value
// ============================================================================

describe('no fabricated weight math', () => {
  test('engine module exports no trend/change/period machinery', () => {
    const mod = src('src/screens/WeightEngine/weightEngine.ts');
    for (const ident of ['describeChange', 'summarize', 'weekWindows', 'PERIOD', 'DAYS_90', 'DAYS_28', 'DAYS_7']) {
      assert.ok(!mod.includes(ident), ident);
    }
  });

  test('screen shows no change line, no history, no period switcher', () => {
    const screen = src('src/screens/WeightEngine/WeightEngineScreen.tsx');
    assert.ok(!screen.includes('vs last'), 'no period comparison');
    assert.ok(!screen.includes('vs previous'), 'no period comparison');
    assert.ok(!screen.includes('7 days') && !screen.includes('28 days') && !screen.includes('90 days'), 'no period switcher');
  });
});

// ============================================================================
// Wiring guards — RN-bound layers pinned by contract
// ============================================================================

describe('batch 6c wiring', () => {
  test('hook reads only the profile cache, patient-scoped, no writes', () => {
    const hook = src('src/hooks/useWeightEngine.ts');
    assert.ok(hook.includes('getProfileCache'), 'single real source');
    assert.ok(hook.includes('getCachedPatientId'), 'patient scope');
    assert.ok(hook.includes('useFocusEffect'), 'focus reload');
    assert.ok(hook.includes('subscribeDataRefresh'), 'dataRefresh');
    assert.ok(!hook.includes('setInterval'), 'no polling');
    assert.ok(!hook.includes('INSERT') && !hook.includes('insert'), 'no writes');
  });

  test('profile cache query is patient-scoped', () => {
    const q = src('src/db/queries/homeCache.ts');
    const start = q.indexOf('export async function getProfileCache');
    const nextExport = q.indexOf('\nexport ', start + 1);
    const body = q.slice(start, nextExport === -1 ? undefined : nextExport);
    assert.ok(body.includes('patient_id = ?'), 'patient scope');
    assert.ok(body.includes('FROM profile_cache'), 'cache read only');
  });

  test('no other engine dashboards were built', () => {
    // Batches 6D–6H complete the set: every engine exists, none beyond it.
    for (const id of ['discipline', 'fitness', 'nutrition', 'wellbeing', 'heart']) {
      if (id === 'discipline') {
        assert.ok(
          fs.existsSync(path.join(ROOT, 'src', 'screens', 'DisciplineEngine', 'DisciplineEngineScreen.tsx')),
          'discipline engine exists (Batch 6D)',
        );
        continue;
      }
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
    assert.ok(fs.existsSync(path.join(ROOT, 'src', 'hooks', 'useDisciplineEngine.ts')));
  });

  test('WeightEngine route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('WeightEngine:'), 'route typed');
    const app = src('App.tsx');
    assert.ok(app.includes('name="WeightEngine"'), 'route registered');
    assert.ok(app.includes('WeightEngineScreen'), 'screen wired');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes("case 'WeightEngine'"), 'hub dispatch handles it');
  });

  test('profile weight is wiped with the patient (no orphan engine data)', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'profile_cache'"), 'profile cache wiped');
  });

  test('no fabricated values anywhere in the engine', () => {
    const hay = [
      src('src/screens/WeightEngine/weightEngine.ts'),
      src('src/screens/WeightEngine/WeightEngineScreen.tsx'),
      src('src/hooks/useWeightEngine.ts'),
    ].join('\n');
    for (const phrase of ['Math.random', 'placeholder', 'sample data', 'mock weight', 'fake']) {
      assert.ok(!hay.toLowerCase().includes(phrase), phrase);
    }
  });

  test('no medical, causal, or outcome promises in engine copy', () => {
    // Instructional patterns (bare-word denials in the footer document
    // the boundary; they are not violations).
    const hay = [
      src('src/screens/WeightEngine/weightEngine.ts'),
      src('src/screens/WeightEngine/WeightEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'you will lose',
      'lose x kg',
      'calorie deficit',
      'metabolic',
      'target date',
      'obes',
      'overweight',
      'bmi',
      'because you',
      'caused by',
      'diet plan',
      'prescrib',
      'will improve',
      'treatment plan',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });

  test('no new table, no migration, no backend endpoint for weight', () => {
    const migrations = src('src/db/migrations.ts');
    assert.ok(!migrations.toLowerCase().includes('weight_entries'), 'no new weight table');
    assert.ok(!migrations.toLowerCase().includes('weight_engine'), 'no engine table');
    const screen = src('src/screens/WeightEngine/WeightEngineScreen.tsx');
    assert.ok(!screen.includes('fetch('), 'no network calls from the engine');
    assert.ok(!screen.includes('sync_queue'), 'no sync writes from the engine');
    assert.ok(!screen.includes('getSleepNights'), 'no cross-engine data borrowing');
  });
});
