/**
 * strength — tests for strength logging (sets × reps × weight).
 *
 * Behavioral coverage (pure + real SQLite, node-testable):
 *   - set normalization (name required; positive weight/reps; kg/lb)
 *   - volume math per exercise/day with lb→kg conversion
 *   - estimated 1RM via Epley (labeled estimate, never a claim)
 *   - PRs: best estimated 1RM per exercise from real rows
 *   - CRUD through REAL delegates (patient isolation, ordering)
 * plus wiring guards (text-level, repo precedent):
 *   - migration 21 creates the table through the REAL chain
 *   - local wipe covers the new table
 *   - no fitter/healthier/causal/clinical language in the surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/strength.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  deleteStrengthSetDb,
  estimateOneRepMax,
  exerciseVolume,
  insertStrengthSetDb,
  listStrengthSetsDb,
  normalizeStrengthInput,
  personalRecords,
} from '../src/db/queries/strength.ts';
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
    exec(sql: string): void {
      s.exec(sql);
    },
  };
}

const STRENGTH_DDL = `
  CREATE TABLE strength_sets (
    entry_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, exercise TEXT NOT NULL,
    weight_value REAL NOT NULL, weight_unit TEXT NOT NULL, reps INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================================
// Normalization + math
// ============================================================================

describe('strength input + math', () => {
  test('valid set passes with trimmed name; bad input throws', () => {
    const out = normalizeStrengthInput({
      exercise: '  Bench Press  ',
      weight_value: 60,
      weight_unit: 'kg',
      reps: 8,
      occurred_at: '2026-10-02T18:00:00',
    });
    assert.equal(out.exercise, 'Bench Press');
    assert.throws(() => normalizeStrengthInput({ exercise: '', weight_value: 60, weight_unit: 'kg', reps: 8, occurred_at: '2026-10-02T18:00:00' }));
    assert.throws(() => normalizeStrengthInput({ exercise: 'Squat', weight_value: 0, weight_unit: 'kg', reps: 5, occurred_at: '2026-10-02T18:00:00' }));
    assert.throws(() => normalizeStrengthInput({ exercise: 'Squat', weight_value: 60, weight_unit: 'stones', reps: 5, occurred_at: '2026-10-02T18:00:00' }));
    assert.throws(() => normalizeStrengthInput({ exercise: 'Squat', weight_value: 60, weight_unit: 'kg', reps: 0, occurred_at: '2026-10-02T18:00:00' }));
    assert.throws(() => normalizeStrengthInput({ exercise: 'Squat', weight_value: 60, weight_unit: 'kg', reps: 5, occurred_at: 'someday' }));
  });

  test('volume sums weight×reps per exercise with lb conversion', () => {
    const sets = [
      { exercise: 'Squat', weight_value: 60, weight_unit: 'kg', reps: 5 },
      { exercise: 'Squat', weight_value: 60, weight_unit: 'kg', reps: 5 },
      { exercise: 'Bench', weight_value: 135, weight_unit: 'lb', reps: 8 },
    ];
    const vol = exerciseVolume(sets);
    assert.equal(vol['Squat'], 600);
    assert.ok(Math.abs((vol['Bench'] ?? 0) - 135 * 0.45359237 * 8) < 0.01);
  });

  test('Epley estimate labeled, singles return the weight', () => {
    assert.equal(estimateOneRepMax(100, 1), 100);
    assert.equal(estimateOneRepMax(100, 5), 116.67);
    assert.equal(estimateOneRepMax(0, 5), null);
  });

  test('PRs take the best estimate per exercise', () => {
    const prs = personalRecords([
      { exercise: 'Squat', weight_value: 60, weight_unit: 'kg', reps: 5 },
      { exercise: 'Squat', weight_value: 62.5, weight_unit: 'kg', reps: 3 },
      { exercise: 'Bench', weight_value: 40, weight_unit: 'kg', reps: 8 },
    ]);
    assert.equal(prs['Squat'], 70);
    assert.ok(Math.abs((prs['Bench'] ?? 0) - 50.67) < 0.01);
  });
});

// ============================================================================
// CRUD through real SQLite
// ============================================================================

describe('strength sets CRUD', () => {
  test('insert/list round-trip newest-first; patients isolated', async () => {
    const db = makeDb();
    db.exec(STRENGTH_DDL);
    const id = await insertStrengthSetDb(db, 'p1', normalizeStrengthInput({
      exercise: 'Deadlift', weight_value: 100, weight_unit: 'kg', reps: 5, occurred_at: '2026-10-02T18:00:00',
    }));
    await insertStrengthSetDb(db, 'p2', normalizeStrengthInput({
      exercise: 'Deadlift', weight_value: 90, weight_unit: 'kg', reps: 5, occurred_at: '2026-10-02T18:00:00',
    }));
    assert.equal((await listStrengthSetsDb(db, 'p1', 100)).length, 1);
    assert.equal(await deleteStrengthSetDb(db, 'p2', id), false);
    assert.equal(await deleteStrengthSetDb(db, 'p1', id), true);
    assert.equal((await listStrengthSetsDb(db, 'p1', 100)).length, 0);
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('strength wiring + copy guards', () => {
  test('query module is device-only; screen renders the section', () => {
    const wiring = src('src/db/queries/strength.ts');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
    const screen = src('src/screens/FitnessEngine/FitnessEngineScreen.tsx');
    assert.ok(screen.includes('Strength'), 'strength section present');
    assert.ok(screen.includes('est. 1RM') || screen.includes('est 1RM'), 'estimates labeled');
  });

  test('migration 21 creates strength_sets through the REAL chain', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    const row = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'strength_sets'",
    );
    assert.equal(row?.name, 'strength_sets');
  });

  test('local wipe covers the strength table', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'strength_sets'"), 'strength wiped');
  });

  test('no fitter/healthier/causal/clinical language in the surface', () => {
    // The new module is fully controlled: bare judgment words stay out.
    const module = src('src/db/queries/strength.ts').toLowerCase();
    for (const phrase of ['fitter', 'healthier', 'diagnos', 'treatment']) {
      assert.ok(!module.includes(phrase), phrase);
    }
    // The screen documents its boundary in comments ("never
    // fitter/healthier"), so batch6e-style: instructional patterns only.
    // The standard wellness denial is allowlisted — it denies claims.
    const screen = src('src/screens/FitnessEngine/FitnessEngineScreen.tsx')
      .toLowerCase()
      .replaceAll('not medical advice, diagnosis, or treatment', '');
    for (const phrase of [
      'you are fitter',
      'makes you stronger',
      'get stronger',
      'because',
      'diagnos',
      'treatment',
    ]) {
      assert.ok(!screen.includes(phrase), phrase);
    }
  });
});
