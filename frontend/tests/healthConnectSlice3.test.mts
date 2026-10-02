/**
 * healthConnectSlice3.test.mts — weight + steps unblocking (node).
 *
 * Weight imports only with a server-valid concept UUID (resolved from the
 * manual-log concepts endpoint, never the bare '29463-7' code that the
 * backend rejects with 422). Steps live in a device-only step_counts table
 * (migration 19, wiped with the patient, never queued for sync) and never
 * enter the Fitness session math.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { runMigrations } from '../src/db/migrations.ts';
import {
  getStepHistory,
  upsertStepDay,
  type StepCountsDb,
} from '../src/db/queries/stepCounts.ts';
import {
  clearConceptCache,
  resolveConceptNames,
  resolveWeightConceptId,
} from '../src/services/healthConnect/conceptResolver.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeDb(): StepCountsDb {
  const s = new DatabaseSync(':memory:');
  const flat = (params: unknown[]) =>
    params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return {
    async execAsync(sql: string): Promise<void> {
      s.exec(sql);
    },
    async runAsync(sql: string, ...params: unknown[]) {
      const stmt = s.prepare(sql);
      const r = stmt.run(...(flat(params) as unknown[]));
      return { changes: Number(r.changes) };
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      return s.prepare(sql).get(...(flat(params) as unknown[])) as T | null ?? null;
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
        s.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

async function migratedDb() {
  const db = makeDb();
  await runMigrations(db as never);
  return db;
}

// ============================================================================
// Weight concept resolution — server UUID or nothing
// ============================================================================

describe('weight concept resolution', () => {
  test('finds the LOINC 29463-7 concept id among manual-log concepts', async () => {
    clearConceptCache();
    const id = await resolveWeightConceptId(async () => [
      { id: 'uuid-glucose', terminology: 'LOINC', code: '2339-0' },
      { id: 'uuid-weight', terminology: 'LOINC', code: '29463-7' },
    ]);
    assert.equal(id, 'uuid-weight');
  });

  test('missing concept, fetch failure, and malformed rows resolve to null', async () => {
    clearConceptCache();
    assert.equal(await resolveWeightConceptId(async () => []), null);
    clearConceptCache();
    assert.equal(
      await resolveWeightConceptId(async () => {
        throw new Error('offline');
      }),
      null,
    );
    clearConceptCache();
    assert.equal(await resolveWeightConceptId(async () => [{ nope: 1 }]), null);
  });

  test('resolution is cached: fetcher runs once for repeated resolves', async () => {
    clearConceptCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return [{ id: 'uuid-weight', terminology: 'LOINC', code: '29463-7' }];
    };
    assert.equal(await resolveWeightConceptId(fetcher), 'uuid-weight');
    assert.equal(await resolveWeightConceptId(fetcher), 'uuid-weight');
    assert.equal(calls, 1);
  });
});

describe('concept name resolution', () => {
  test('id to display name map, malformed rows skipped, failure-safe', async () => {
    const names = await resolveConceptNames(async () => [
      { id: 'u1', display_name: 'Headache', short_name: 'Head' },
      { id: 'u2', display_name: '', short_name: 'Nausea' },
      { id: '', display_name: 'Ghost' },
      { nope: 1 },
    ]);
    assert.equal(names.get('u1'), 'Headache');
    assert.equal(names.get('u2'), 'Nausea');
    assert.equal(names.size, 2);
    assert.deepEqual([...(await resolveConceptNames(async () => { throw new Error('offline'); })).entries()], []);
  });
});

// ============================================================================
// step_counts — device-only daily totals, monotonic, patient-isolated
// ============================================================================

describe('step_counts storage', () => {
  test('migration creates step_counts; upsert keeps the max; history ascends', async () => {
    const db = await migratedDb();
    await upsertStepDay(db, 'pat-A', '2026-09-30', 8000);
    await upsertStepDay(db, 'pat-A', '2026-09-30', 5000);
    await upsertStepDay(db, 'pat-A', '2026-10-01', 3000);
    await upsertStepDay(db, 'pat-B', '2026-09-30', 9000);
    assert.deepEqual(await getStepHistory(db, 'pat-A', '2026-09-01', '2026-10-31'), [
      { log_date: '2026-09-30', steps: 8000 },
      { log_date: '2026-10-01', steps: 3000 },
    ]);
  });

  test('absurd and malformed step values are refused', async () => {
    const db = await migratedDb();
    await assert.rejects(upsertStepDay(db, 'pat-A', '2026-09-30', -5));
    await assert.rejects(upsertStepDay(db, 'pat-A', '2026-09-30', 500000));
    await assert.rejects(upsertStepDay(db, 'pat-A', 'not-a-date', 100));
    assert.deepEqual(await getStepHistory(db, 'pat-A', '2026-09-01', '2026-10-31'), []);
  });
});

// ============================================================================
// Slice 3 wiring guards
// ============================================================================

describe('slice 3 wiring guards', () => {
  test('step_counts is device-only: no sync columns, wiped with the patient', () => {
    const migration = src('src/db/migrations.ts');
    assert.ok(!/step_counts[\s\S]{0,600}sync_status/.test(migration), 'no sync_status near step_counts');
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'step_counts'"), 'wiped with the patient');
  });

  test('steps never enter the fitness session math', () => {
    // Strip block comments: the contract documents the separation in prose;
    // the code underneath must not reference steps anywhere.
    const engine = src('src/screens/FitnessEngine/fitnessEngine.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of ['steps', 'step_counts', 'StepHistory', 'stepCounts']) {
      assert.ok(!engine.includes(banned), `sessions/minutes math untouched: ${banned}`);
    }
  });

  test('weight import never uses the bare code as a concept id', () => {
    const hay = [
      src('src/services/healthConnect/importer.ts'),
      src('src/services/healthConnect/nativeAdapter.ts'),
    ].join('\n');
    // Recognition comparisons (=== '29463-7') are fine; assigning it as a
    // concept_id is what 422s — that must come from the resolver variable.
    assert.ok(!/concept_id.{0,16}29463/.test(hay), 'concept id comes from the resolver only');
  });
});
