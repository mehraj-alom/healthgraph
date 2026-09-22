/**
 * onboardingBatch1 — tests for onboarding + personalization.
 *
 * Behavioral coverage (real in-memory SQLite via node:sqlite):
 *   - onboarding_state CRUD through the REAL query delegates (save, read,
 *     complete, isolation across patients, idempotent completion)
 *   - gate resolution: completed → skip; established user → grandfathered;
 *     fresh user → setup needed
 *   - momentum week builder: real-signal mapping, honest empty state,
 *     malformed input never crashes
 *   - option catalog: stable ids, sanitizer drops unknowns/dupes
 *   - migration 12 creates the table through the REAL migration chain
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - App gate (setup route, loading hold, completion propagation)
 *   - setup flow (per-step persistence, completion handoff)
 *   - SystemVisual carries all seven areas incl. Medications + gradient
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/onboardingBatch1.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  markOnboardingCompleteDb,
  queryOnboardingState,
  resolveOnboardingGate,
  saveOnboardingSelectionsDb,
} from '../src/db/queries/onboarding.ts';
import {
  FOCUS_AREAS,
  HEALTH_GOALS,
  sanitizeSelections,
} from '../src/screens/Onboarding/options.ts';
import { ENGINE_IDS } from '../src/screens/HealthAreas/engines.ts';
import {
  buildMomentumWeek,
  isMomentumEmpty,
  momentumActiveDays,
} from '../src/screens/Onboarding/momentum.ts';
import { runMigrations } from '../src/db/migrations.ts';

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

// Facade over node:sqlite matching the OnboardingDb surface (same shape as
// migrations.test.mts makeDb, including the single-array-arg unwrap).
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
    exec(sql: string): void {
      s.exec(sql);
    },
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
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
// Onboarding state CRUD — real SQL through production delegates
// ============================================================================

describe('onboarding state storage', () => {
  test('save then read round-trips selections, incomplete by default', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    assert.equal(await queryOnboardingState(db, 'pat-A'), null);
    await saveOnboardingSelectionsDb(db, 'pat-A', ['sleep', 'heart'], ['energy']);
    assert.deepEqual(await queryOnboardingState(db, 'pat-A'), {
      completed: false,
      goals: ['sleep', 'heart'],
      focus: ['energy'],
    });
  });

  test('completion preserves selections; repeat completion is idempotent', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    await saveOnboardingSelectionsDb(db, 'pat-A', ['sleep'], []);
    await markOnboardingCompleteDb(db, 'pat-A');
    await markOnboardingCompleteDb(db, 'pat-A');
    assert.deepEqual(await queryOnboardingState(db, 'pat-A'), {
      completed: true,
      goals: ['sleep'],
      focus: [],
    });
  });

  test('selections never leak across patients', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    await saveOnboardingSelectionsDb(db, 'pat-A', ['sleep'], ['energy']);
    await markOnboardingCompleteDb(db, 'pat-B');
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.completed, false);
    assert.deepEqual((await queryOnboardingState(db, 'pat-B'))?.goals, []);
    assert.equal(await queryOnboardingState(db, 'pat-C'), null);
  });

  test('corrupt stored JSON degrades to empty selections, never throws', async () => {
    const db = makeDb();
    db.exec(ONBOARDING_DDL);
    db.exec(
      "INSERT INTO onboarding_state VALUES ('pat-A', 0, 'not-json', '{\"a\":1}', 'now')",
    );
    assert.deepEqual(await queryOnboardingState(db, 'pat-A'), {
      completed: false,
      goals: [],
      focus: [],
    });
  });

  test('migration 12 creates the table through the real chain', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'onboarding_state'",
    );
    assert.equal(tables.length, 1);
    await saveOnboardingSelectionsDb(db, 'pat-A', ['sleep'], []);
    assert.deepEqual((await queryOnboardingState(db, 'pat-A'))?.goals, ['sleep']);
  });
});

// ============================================================================
// Gate resolution — pure contract
// ============================================================================

describe('resolveOnboardingGate', () => {
  test('completed row never needs setup', () => {
    assert.deepEqual(
      resolveOnboardingGate({ completed: true, goals: [], focus: [] }, false),
      { needed: false, grandfathered: false },
    );
    assert.deepEqual(
      resolveOnboardingGate({ completed: true, goals: ['sleep'], focus: [] }, true),
      { needed: false, grandfathered: false },
    );
  });

  test('established user without a row is grandfathered (never interrupted)', () => {
    assert.deepEqual(resolveOnboardingGate(null, true), {
      needed: false,
      grandfathered: true,
    });
  });

  test('fresh user without data needs setup', () => {
    assert.deepEqual(resolveOnboardingGate(null, false), {
      needed: true,
      grandfathered: false,
    });
    assert.deepEqual(
      resolveOnboardingGate({ completed: false, goals: [], focus: [] }, false),
      { needed: true, grandfathered: false },
    );
  });
});

// ============================================================================
// Option catalog — stable ids, safe sanitizer
// ============================================================================

describe('option catalog', () => {
  test('seven goals; focus areas equal the engine catalog', () => {
    assert.equal(HEALTH_GOALS.length, 7);
    // Batch 6A: focus IS the engine catalog — pinned by import, not text.
    assert.deepEqual(
      FOCUS_AREAS.map((o) => o.id),
      [...ENGINE_IDS],
    );
    for (const id of ['sleep', 'fitness', 'weight', 'nutrition', 'heart', 'wellbeing', 'history']) {
      assert.ok(HEALTH_GOALS.some((o) => o.id === id), id);
    }
  });

  test('sanitizer drops unknowns, dedupes, caps, tolerates null', () => {
    assert.deepEqual(
      sanitizeSelections(['sleep', 'nope', 'sleep', 'heart', 42 as never, ''], HEALTH_GOALS),
      ['sleep', 'heart'],
    );
    assert.deepEqual(sanitizeSelections(null, HEALTH_GOALS), []);
    assert.deepEqual(sanitizeSelections(undefined, FOCUS_AREAS), []);
    assert.equal(sanitizeSelections(HEALTH_GOALS.map((o) => o.id), HEALTH_GOALS, 3).length, 3);
  });

  test('focus language carries no diagnosis framing', () => {
    const hay = FOCUS_AREAS.map((o) => `${o.label} ${o.hint}`.toLowerCase()).join(' | ');
    for (const word of ['diagnos', 'disease', 'disorder', 'treatment', 'prescrib']) {
      assert.ok(!hay.includes(word), word);
    }
  });
});

// ============================================================================
// Momentum week — real signals only, honest empty state
// ============================================================================

describe('buildMomentumWeek', () => {
  test('maps logs, heart rates and doses onto the trailing 7 days', () => {
    const days = buildMomentumWeek(
      '2026-09-21',
      ['2026-09-21', '2026-09-19'],
      { '2026-09-21': 72.4, '2026-09-18': 68 },
      { '2026-09-20': 2 },
    );
    assert.equal(days.length, 7);
    assert.equal(days[0].date, '2026-09-15');
    assert.equal(days[6].date, '2026-09-21');
    assert.deepEqual(days.map((d) => d.weekday).length, 7);
    const today = days[6];
    assert.equal(today.logged, true);
    assert.equal(today.heartRate, 72);
    const sep20 = days.find((d) => d.date === '2026-09-20');
    assert.equal(sep20?.dosesTaken, 2);
    assert.equal(sep20?.active, true);
    const sep18 = days.find((d) => d.date === '2026-09-18');
    assert.equal(sep18?.heartRate, 68);
    const quiet = days.find((d) => d.date === '2026-09-15');
    assert.deepEqual(
      { logged: quiet?.logged, heartRate: quiet?.heartRate, dosesTaken: quiet?.dosesTaken, active: quiet?.active },
      { logged: false, heartRate: null, dosesTaken: 0, active: false },
    );
  });

  test('empty input is a legitimate empty week (never fabricated)', () => {
    const days = buildMomentumWeek('2026-09-21', [], {}, {});
    assert.equal(days.length, 7);
    assert.equal(isMomentumEmpty(days), true);
    assert.equal(momentumActiveDays(days), 0);
    assert.ok(days.every((d) => d.heartRate === null && d.dosesTaken === 0 && !d.logged));
  });

  test('malformed values degrade safely', () => {
    const days = buildMomentumWeek(
      '2026-09-21',
      ['not-a-date', '2026-09-21T08:00:00.000Z'],
      { '2026-09-21': Number.NaN, '2026-09-20': Number.POSITIVE_INFINITY },
      { '2026-09-20': -3 },
    );
    assert.equal(days.length, 7);
    assert.equal(days[6].logged, true);
    assert.equal(days[6].heartRate, null);
    assert.equal(days.find((d) => d.date === '2026-09-20')?.dosesTaken, 0);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers (text-level, repo precedent)
// ============================================================================

describe('batch 1 wiring', () => {
  test('App gate routes first-run patients to setup, others to Main', () => {
    const app = src('App.tsx');
    assert.ok(app.includes('OnboardingSetupScreen'), 'setup screen imported');
    // Registered TWICE by design: the gate branch (automatic first-run
    // routing) AND the main list (manual Settings re-entry must work even
    // when the gate resolved "no setup needed" — otherwise NAVIGATE is
    // unhandled). The branches are mutually exclusive, never duplicated.
    const registrations = app.match(/name="OnboardingSetup"/g) ?? [];
    assert.equal(registrations.length, 2);
    assert.ok(app.includes('setupNeeded'), 'gate state');
    assert.ok(app.includes('resolveOnboardingGateDb'), 'per-patient gate resolution');
    assert.ok(app.includes('user && !setupChecked'), 'no Main flash before gate resolves');
  });

  test('setup flow persists per step and completes exactly once', () => {
    const setup = src('src/screens/Onboarding/OnboardingSetupScreen.tsx');
    assert.ok(setup.includes('await save(goals, focus)'), 'selections saved on advance');
    assert.ok(setup.includes('await complete()'), 'completion on Start');
    assert.ok(setup.includes('PAGE_LIST'), 'bounded pager');
  });

  test('SystemVisual carries all seven areas with a gradient hub ring', () => {
    const visual = src('src/screens/Onboarding/SystemVisual.tsx');
    for (const label of ['Sleep', 'Heart', 'Nutrition', 'Activity', 'Wellbeing', 'Medications', 'Records']) {
      assert.ok(visual.includes(`'${label}'`) || visual.includes(`"${label}"`), label);
    }
    assert.ok(visual.includes('LinearGradient'), 'green-teal gradient (official svg API)');
    assert.ok(visual.includes('url(#hg-hub-grad)'), 'gradient applied to hub ring');
  });

  test('hooks resolve identity before reading patient state', () => {
    for (const rel of ['src/hooks/useOnboardingState.ts', 'src/hooks/useMomentumWeek.ts']) {
      const hook = src(rel);
      assert.ok(hook.includes('waitForIdentityReady'), `${rel}: identity race guard`);
      assert.ok(hook.includes('getCachedPatientId()'), `${rel}: patient scoping`);
      assert.ok(hook.includes('subscribeDataRefresh'), `${rel}: live propagation`);
    }
  });
});
