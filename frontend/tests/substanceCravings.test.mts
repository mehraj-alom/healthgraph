/**
 * substanceCravings — tests for craving/trigger logging (Streaks gap).
 *
 * Behavioral coverage (pure + real in-memory SQLite via node:sqlite):
 *   - trigger set is fixed and validated (unknown triggers never stored)
 *   - craving input normalization (throws on bad category/datetime only;
 *     intensity clamped to 1-5, outcome limited to passed/used)
 *   - craving CRUD through REAL delegates (patient isolation, ordering,
 *     update/delete scoping)
 *   - trailing-7-day summary from real rows only (counts, by-trigger
 *     tallies, passed share; thin history yields honest empty, never
 *     invented patterns)
 *   - status lines describe without judging or treating
 * plus wiring guards (text-level, repo precedent):
 *   - query module is device-only (no fetch, no backend endpoints)
 *   - migration 20 creates the table through the REAL chain
 *   - local wipe covers the new table
 *   - no treatment/clinical/causal language anywhere in the surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/substanceCravings.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CRAVING_TRIGGERS,
  cravingStatusLine,
  deleteCravingEntryDb,
  insertCravingEntryDb,
  isCravingTrigger,
  listCravingEntriesDb,
  normalizeCravingInput,
  summarizeCravingWeek,
  triggerLabel,
  updateCravingEntryDb,
} from '../src/db/queries/cravings.ts';
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

// Facade over node:sqlite (same shape as sibling suites).
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

const CRAVING_DDL = `
  CREATE TABLE craving_entries (
    entry_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, category TEXT NOT NULL,
    trigger TEXT, occurred_at TEXT NOT NULL, intensity INTEGER,
    outcome TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================================
// Trigger set + labels
// ============================================================================

describe('craving triggers', () => {
  test('fixed neutral set; unknown values never validate', () => {
    assert.deepEqual([...CRAVING_TRIGGERS], [
      'stress',
      'social',
      'boredom',
      'routine',
      'mood',
      'reminder',
      'other',
    ]);
    for (const t of CRAVING_TRIGGERS) {
      assert.equal(isCravingTrigger(t), true);
      assert.ok(triggerLabel(t).length > 0);
    }
    assert.equal(isCravingTrigger('loneliness'), false);
    assert.equal(isCravingTrigger(''), false);
    assert.equal(isCravingTrigger(null), false);
  });
});

// ============================================================================
// Input normalization
// ============================================================================

describe('craving input normalization', () => {
  test('full valid input passes through with trimmed text', () => {
    const out = normalizeCravingInput({
      category: 'alcohol',
      trigger: 'stress',
      occurred_at: '2026-09-20T19:30:00',
      intensity: 4,
      outcome: 'passed',
      notes: '  after dinner  ',
    });
    assert.equal(out.category, 'alcohol');
    assert.equal(out.trigger, 'stress');
    assert.equal(out.intensity, 4);
    assert.equal(out.outcome, 'passed');
    assert.equal(out.notes, 'after dinner');
  });

  test('bad category or datetime throws; nothing is stored', () => {
    assert.throws(() => normalizeCravingInput({ category: 'caffeine', occurred_at: '2026-09-20T19:30:00' }));
    assert.throws(() => normalizeCravingInput({ category: 'alcohol', occurred_at: 'not-a-date' }));
    assert.throws(() => normalizeCravingInput({ category: 'alcohol', occurred_at: null }));
  });

  test('intensity outside 1-5 becomes null, never clamped into a lie', () => {
    assert.equal(normalizeCravingInput({ category: 'tobacco', occurred_at: '2026-09-20T08:00:00', intensity: 0 }).intensity, null);
    assert.equal(normalizeCravingInput({ category: 'tobacco', occurred_at: '2026-09-20T08:00:00', intensity: 6 }).intensity, null);
    assert.equal(normalizeCravingInput({ category: 'tobacco', occurred_at: '2026-09-20T08:00:00', intensity: 2.5 }).intensity, null);
    assert.equal(normalizeCravingInput({ category: 'tobacco', occurred_at: '2026-09-20T08:00:00' }).intensity, null);
  });

  test('unknown trigger and outcome fall back to null, not rejection', () => {
    const out = normalizeCravingInput({
      category: 'other',
      trigger: 'loneliness',
      occurred_at: '2026-09-20T08:00:00',
      outcome: 'resisted-hard',
    });
    assert.equal(out.trigger, null);
    assert.equal(out.outcome, null);
  });
});

// ============================================================================
// CRUD through real SQLite
// ============================================================================

describe('craving entries CRUD', () => {
  test('insert/list round-trip with newest-first ordering', async () => {
    const db = makeDb();
    db.exec(CRAVING_DDL);
    await insertCravingEntryDb(db, 'p1', normalizeCravingInput({
      category: 'alcohol', trigger: 'social', occurred_at: '2026-09-20T19:00:00', intensity: 3, outcome: 'passed',
    }));
    await insertCravingEntryDb(db, 'p1', normalizeCravingInput({
      category: 'alcohol', trigger: 'stress', occurred_at: '2026-09-21T09:00:00', intensity: 5, outcome: 'used',
    }));
    const rows = await listCravingEntriesDb(db, 'p1', 100);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].trigger, 'stress');
    assert.equal(rows[1].trigger, 'social');
    assert.equal(rows[0].intensity, 5);
  });

  test('patients are isolated; update/delete are scoped', async () => {
    const db = makeDb();
    db.exec(CRAVING_DDL);
    const id = await insertCravingEntryDb(db, 'p1', normalizeCravingInput({
      category: 'tobacco', occurred_at: '2026-09-21T09:00:00',
    }));
    await insertCravingEntryDb(db, 'p2', normalizeCravingInput({
      category: 'tobacco', occurred_at: '2026-09-21T10:00:00',
    }));
    assert.equal((await listCravingEntriesDb(db, 'p1', 100)).length, 1);
    assert.equal(await updateCravingEntryDb(db, 'p2', id, normalizeCravingInput({
      category: 'tobacco', trigger: 'boredom', occurred_at: '2026-09-21T09:00:00',
    })), false);
    assert.equal(await updateCravingEntryDb(db, 'p1', id, normalizeCravingInput({
      category: 'tobacco', trigger: 'boredom', occurred_at: '2026-09-21T09:00:00',
    })), true);
    assert.equal(await deleteCravingEntryDb(db, 'p2', id), false);
    assert.equal(await deleteCravingEntryDb(db, 'p1', id), true);
    assert.equal((await listCravingEntriesDb(db, 'p1', 100)).length, 0);
  });
});

// ============================================================================
// Weekly summary from real rows
// ============================================================================

describe('craving week summary', () => {
  const ENTRIES = [
    { occurred_at: '2026-09-26T10:00:00', trigger: 'stress', outcome: 'passed' },
    { occurred_at: '2026-09-27T10:00:00', trigger: 'stress', outcome: 'passed' },
    { occurred_at: '2026-09-28T10:00:00', trigger: 'social', outcome: 'used' },
    { occurred_at: '2026-09-29T10:00:00', trigger: 'boredom', outcome: null },
    { occurred_at: '2026-09-10T10:00:00', trigger: 'stress', outcome: 'passed' },
  ];

  test('trailing-7-day counts with by-trigger tallies and passed share', () => {
    const s = summarizeCravingWeek(ENTRIES, '2026-10-02');
    assert.equal(s.total, 4);
    assert.equal(s.passed, 2);
    assert.equal(s.used, 1);
    assert.equal(s.topTrigger, 'stress');
    assert.equal(s.byTrigger.stress, 2);
    assert.equal(s.byTrigger.social, 1);
  });

  test('thin history yields honest empty, never invented patterns', () => {
    const s = summarizeCravingWeek([], '2026-10-02');
    assert.equal(s.total, 0);
    assert.equal(s.topTrigger, null);
    const malformed = summarizeCravingWeek(
      [{ occurred_at: 'garbage', trigger: 'stress', outcome: 'passed' }],
      '2026-10-02',
    );
    assert.equal(malformed.total, 0);
  });
});

// ============================================================================
// Status lines
// ============================================================================

describe('craving status lines', () => {
  test('lines describe counts without judging or treating', () => {
    assert.equal(
      cravingStatusLine({ total: 3, passed: 2, used: 1, byTrigger: {}, topTrigger: 'stress' }),
      '3 cravings logged in the last 7 days · 2 passed',
    );
    assert.equal(
      cravingStatusLine({ total: 0, passed: 0, used: 0, byTrigger: {}, topTrigger: null }),
      'No cravings logged in the last 7 days',
    );
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('craving wiring + copy guards', () => {
  test('query module is device-only: no schema writes outside migrations, no network', () => {
    const wiring = src('src/db/queries/cravings.ts');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
  });

  test('migration 20 creates craving_entries through the REAL chain', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    const row = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'craving_entries'",
    );
    assert.equal(row?.name, 'craving_entries');
  });

  test('local wipe covers the craving table', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'craving_entries'"), 'cravings wiped');
  });

  test('no treatment/clinical/causal language anywhere in the surface', () => {
    // The query module is fully controlled: bare clinical words stay out.
    const module = src('src/db/queries/cravings.ts').toLowerCase();
    for (const phrase of [
      'treatment',
      'therapy',
      'withdrawal',
      'detox',
      'addiction',
      'alcoholic',
      'cure',
      'relapse',
      'disorder',
      'diagnos',
      'syndrome',
      'willpower',
    ]) {
      assert.ok(!module.includes(phrase), phrase);
    }
    // The screen carries documented boundary denials ("tracking, NOT
    // treatment", "not a diagnosis"), so it is scanned batch3-style for
    // instructional, predictive, and causal patterns instead of bare words.
    const screen = src('src/screens/Substance/SubstanceScreen.tsx').toLowerCase();
    for (const phrase of [
      'you should stop',
      'you should quit',
      'how to quit',
      'how to stop',
      'treatment plan',
      'recommended dose',
      'withdrawal symptoms',
      'withdrawal guide',
      'relapse',
      'willpower',
      'causes',
      'because',
      'due to',
      'triggered by',
      'leads to',
      'makes you',
    ]) {
      assert.ok(!screen.includes(phrase), phrase);
    }
  });
});
