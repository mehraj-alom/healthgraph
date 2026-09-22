/**
 * batch6a — tests for the goal-driven engine architecture.
 *
 * Behavioral coverage (pure, node-runnable):
 *   - single / multiple / all / empty selections activate correctly
 *   - add + remove flow, no duplicate ids, unknown ids dropped
 *   - legacy pre-engine focus ids forward-map (nothing silently lost)
 *   - catalog stability (7 ids, unique, every engine has copy + glyph)
 *   - focus options derive from the engine catalog (no drift)
 *   - hub ordering pins active areas stably
 *   - onboarding SQL round-trips engine ids with patient isolation
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - hook is the single selector (no per-engine branches in product code)
 *   - Settings re-entry + gate preservation
 *   - deletion wipes the whole onboarding row (selections included)
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/batch6a.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ENGINES,
  ENGINE_IDS,
  deriveActiveEngines,
  getActiveEngines,
  isEngineId,
  migrateLegacyFocus,
  sanitizeEngineIds,
} from '../src/screens/HealthAreas/engines.ts';
import { FOCUS_AREAS } from '../src/screens/Onboarding/options.ts';
import { orderAreasByEngines } from '../src/screens/HealthAreas/areas.ts';
import {
  markOnboardingCompleteDb,
  queryOnboardingState,
  saveOnboardingSelectionsDb,
} from '../src/db/queries/onboarding.ts';

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

function makeDb() {
  const s = new DatabaseSync(':memory:');
  const flat = (params: unknown[]) =>
    params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return {
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const r = s.prepare(sql).get(...(flat(params) as unknown[])) as T | undefined;
      return r ?? null;
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const r = s.prepare(sql).run(...(flat(params) as unknown[]));
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return s.prepare(sql).all(...(flat(params) as unknown[])) as T[];
    },
    exec(sql: string): void {
      s.exec(sql);
    },
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      s.exec('BEGIN');
      try {
        await fn();
        s.exec('COMMIT');
      } catch (e) {
        try {
          s.exec('ROLLBACK');
        } catch {
          // Already rolled back.
        }
        throw e;
      }
    },
  };
}

const ONBOARDING_DDL = `
  CREATE TABLE onboarding_state (
    patient_id TEXT PRIMARY KEY,
    completed INTEGER NOT NULL DEFAULT 0,
    goals_json TEXT NOT NULL DEFAULT '[]',
    focus_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================================
// Catalog + activation
// ============================================================================

describe('engine catalog', () => {
  test('seven stable unique engines with complete metadata', () => {
    assert.deepEqual([...ENGINE_IDS], [
      'sleep',
      'weight',
      'discipline',
      'fitness',
      'nutrition',
      'wellbeing',
      'heart',
    ]);
    for (const id of ENGINE_IDS) {
      const def = ENGINES[id];
      assert.ok(def.title.length > 0, `${id}: title`);
      assert.ok(def.description.length > 0, `${id}: description`);
      assert.ok(def.glyph.length > 0, `${id}: glyph`);
    }
  });

  test('single selection activates exactly one engine', () => {
    assert.deepEqual(
      deriveActiveEngines(['sleep']).map((e) => e.id),
      ['sleep'],
    );
  });

  test('multiple selections coexist (sleep + discipline)', () => {
    assert.deepEqual(
      deriveActiveEngines(['sleep', 'discipline']).map((e) => e.id),
      ['sleep', 'discipline'],
    );
  });

  test('weight + nutrition + activity-style combos activate together', () => {
    // 'activity' is not an engine id (fitness is) — unknown ids drop out.
    assert.deepEqual(
      deriveActiveEngines(['weight', 'nutrition', 'fitness']).map((e) => e.id),
      ['weight', 'fitness', 'nutrition'],
    );
  });

  test('all engines, empty selection, duplicates, unknowns', () => {
    assert.equal(deriveActiveEngines([...ENGINE_IDS]).length, 7);
    assert.deepEqual(deriveActiveEngines([]), []);
    assert.deepEqual(deriveActiveEngines(['sleep', 'sleep', 'bogus']).map((e) => e.id), ['sleep']);
    assert.equal(isEngineId('discipline'), true);
    assert.equal(isEngineId('meditation'), false);
  });

  test('getActiveEngines reads focus state (null-safe)', () => {
    assert.deepEqual(getActiveEngines(null).map((e) => e.id), []);
    assert.deepEqual(getActiveEngines({}).map((e) => e.id), []);
    assert.deepEqual(
      getActiveEngines({ focus: ['heart', 'nutrition'] }).map((e) => e.id),
      ['nutrition', 'heart'],
    );
  });

  test('legacy focus ids forward-map; records-clarity drops honestly', () => {
    assert.deepEqual(
      migrateLegacyFocus(['sleep-quality', 'movement', 'records-clarity', 'heart']),
      ['sleep', 'fitness', 'heart'],
    );
    assert.deepEqual(sanitizeEngineIds(['energy', 'energy', 'nope']), ['wellbeing']);
  });

  test('focus options derive from the engine catalog (no drift possible)', () => {
    assert.deepEqual(
      FOCUS_AREAS.map((o) => o.id),
      [...ENGINE_IDS],
    );
    for (const opt of FOCUS_AREAS) {
      assert.equal(opt.label, ENGINES[opt.id as keyof typeof ENGINES].title);
    }
  });
});

// ============================================================================
// Hub ordering — active engines pin first, stably
// ============================================================================

describe('orderAreasByEngines', () => {
  const areas = [
    { id: 'heart' },
    { id: 'sleep' },
    { id: 'medications' },
    { id: 'weight' },
  ] as const;

  test('active areas pin first, others keep relative order', () => {
    assert.deepEqual(
      orderAreasByEngines([...areas], ['sleep', 'weight']).map((a) => a.id),
      ['sleep', 'weight', 'heart', 'medications'],
    );
  });

  test('empty/unknown selections leave order untouched', () => {
    assert.deepEqual(
      orderAreasByEngines([...areas], []).map((a) => a.id),
      ['heart', 'sleep', 'medications', 'weight'],
    );
    assert.deepEqual(
      orderAreasByEngines([...areas], ['discipline', 'bogus']).map((a) => a.id),
      ['heart', 'sleep', 'medications', 'weight'],
    );
  });

  test('fitness pins its activity area (engine→area mapping)', () => {
    const withActivity = [...areas, { id: 'activity' }] as { id: 'activity' | 'heart' | 'sleep' | 'medications' | 'weight' }[];
    assert.equal(orderAreasByEngines(withActivity, ['fitness'])[0].id, 'activity');
  });
});

// ============================================================================
// Persistence — engine ids round-trip per patient, wiped on deletion
// ============================================================================

describe('engine selection persistence', () => {
  test('save/read round-trips, completion preserves, isolation holds', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    await saveOnboardingSelectionsDb(db, 'pat-A', [], ['sleep', 'discipline']);
    await saveOnboardingSelectionsDb(db, 'pat-B', [], ['heart']);
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.focus, ['sleep', 'discipline']);
    assert.deepEqual((await queryOnboardingState(db, 'pat-B'))?.focus, ['heart']);
    await markOnboardingCompleteDb(db, 'pat-A');
    // Selections survive completion (changing focus never deletes history).
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.focus, ['sleep', 'discipline']);
    assert.equal((await queryOnboardingState(db, 'pat-C')), null);
  });

  test('add then remove engine persists exactly', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    await saveOnboardingSelectionsDb(db, 'pat-A', [], ['sleep']);
    await saveOnboardingSelectionsDb(db, 'pat-A', [], ['sleep', 'weight']);
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.focus, ['sleep', 'weight']);
    await saveOnboardingSelectionsDb(db, 'pat-A', [], ['weight']);
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.focus, ['weight']);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('batch 6a wiring', () => {
  test('single selector with no per-engine branches in product code', () => {
    const hook = src('src/hooks/useActiveEngines.ts');
    assert.ok(hook.includes('deriveActiveEngines'), 'delegates to catalog filter');
    assert.ok(!/if\s*\(.*sleep|else if|switch\s*\(/.test(hook), 'no per-engine branches');
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes('orderAreasByEngines'), 'hub pins active areas');
    assert.ok(hub.includes('useActiveEngines()'), 'hub consumes the selector');
  });

  test('Settings re-entry updates activation (same save path)', () => {
    // Re-entry moved to the Priority world's Edit action (same save path).
    const world = src('src/screens/Priority/PriorityWorldScreen.tsx');
    assert.ok(world.includes("navigate('OnboardingSetup')"), 're-entry link intact');
    const hook = src('src/hooks/useOnboardingState.ts');
    assert.ok(hook.includes('migrateLegacyFocus'), 'legacy forward-mapping wired');
  });

  test('deletion wipes selections with the onboarding row', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes('onboarding_state'), 'row removed wholesale (selections included)');
  });

  test('no engine intelligence or medical outcomes promised', () => {
    // Instructional/predictive patterns (bare-word denials in comments
    // document the boundary; they are not violations).
    const hay = [
      src('src/screens/HealthAreas/engines.ts'),
      src('src/screens/Onboarding/FocusStep.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'will improve',
      'guarantee',
      'you are diagnosed',
      'treatment plan',
      'prescrib',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
