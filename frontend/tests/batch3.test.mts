/**
 * batch3 — tests for substance/cycle tracking, 3D wiring, and health areas.
 *
 * Behavioral coverage (pure + real in-memory SQLite via node:sqlite):
 *   - substance CRUD through REAL delegates (isolation, validation,
 *     weekly aggregation from real rows only)
 *   - cycle CRUD + span grouping + date validation
 *   - migration 13 creates both tables through the REAL chain
 *   - health-area status model (available vs honest no-data, provenance)
 *   - 3D region mapping (known id, unknown id, node lookup)
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - tracker screens are device-only (no API imports)
 *   - body panel links regions to HealthGraph with existing IDs
 *   - routes + settings entry registered
 *   - no treatment/prediction/diagnosis language
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/batch3.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  deleteSubstanceEntryDb,
  insertSubstanceEntryDb,
  isSubstanceCategory,
  listSubstanceEntriesDb,
  normalizeSubstanceInput,
  summarizeSubstanceWeeks,
  updateSubstanceEntryDb,
} from '../src/db/queries/substances.ts';
import {
  deleteCycleEntryDb,
  groupCycleSpans,
  insertCycleEntryDb,
  isCalendarDay,
  isCycleKind,
  listCycleEntriesDb,
  normalizeCycleInput,
  updateCycleEntryDb,
  type CycleEntry,
} from '../src/db/queries/cycle.ts';
import {
  buildHealthAreas,
} from '../src/screens/HealthAreas/areas.ts';
import {
  getMapping,
  getStructuresForNode,
  MVP_STRUCTURE_IDS,
} from '../src/assets/anatomy/anatomyMap.ts';
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

const SUBSTANCE_DDL = `
  CREATE TABLE substance_entries (
    entry_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, category TEXT NOT NULL,
    label TEXT, occurred_at TEXT NOT NULL, amount_value REAL, amount_unit TEXT,
    notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
const CYCLE_DDL = `
  CREATE TABLE cycle_entries (
    entry_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, kind TEXT NOT NULL,
    date TEXT NOT NULL, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

// ============================================================================
// Substance tracking — real SQL + pure validation
// ============================================================================

describe('substance tracking', () => {
  test('categories are exactly alcohol/tobacco/other', () => {
    assert.equal(isSubstanceCategory('alcohol'), true);
    assert.equal(isSubstanceCategory('tobacco'), true);
    assert.equal(isSubstanceCategory('other'), true);
    assert.equal(isSubstanceCategory('cannabis'), false);
    assert.equal(isSubstanceCategory(''), false);
    assert.equal(isSubstanceCategory(null), false);
  });

  test('normalize accepts honest input, rejects the rest', () => {
    const good = normalizeSubstanceInput({
      category: 'alcohol',
      label: ' dinner ',
      occurred_at: '2026-09-20T19:30:00',
      amount_value: 2,
      amount_unit: 'drinks',
      notes: '  ok  ',
    });
    assert.deepEqual([good.category, good.label, good.amount_value, good.amount_unit], ['alcohol', 'dinner', 2, 'drinks']);
    assert.throws(() => normalizeSubstanceInput({ category: 'wine', occurred_at: '2026-09-20T19:30:00' }), /Choose/);
    assert.throws(() => normalizeSubstanceInput({ category: 'alcohol', occurred_at: 'whenever' }), /valid date/);
    // Negative amounts and units without values are dropped, never stored.
    const noAmount = normalizeSubstanceInput({ category: 'tobacco', occurred_at: '2026-09-20T19:30:00', amount_value: -1, amount_unit: 'x' });
    assert.equal(noAmount.amount_value, null);
    assert.equal(noAmount.amount_unit, null);
  });

  test('CRUD round-trips with patient isolation', async () => {
    const db = makeDb();
    db.exec(SUBSTANCE_DDL);
    const id = await insertSubstanceEntryDb(db, 'pat-A', {
      category: 'alcohol',
      label: 'dinner',
      occurred_at: '2026-09-20T19:30:00',
      amount_value: 2,
      amount_unit: 'drinks',
      notes: null,
    });
    assert.ok(id.length > 0);
    assert.equal((await listSubstanceEntriesDb(db, 'pat-A')).length, 1);
    assert.equal((await listSubstanceEntriesDb(db, 'pat-B')).length, 0);
    assert.equal(
      await updateSubstanceEntryDb(db, 'pat-A', id, {
        category: 'alcohol',
        label: 'party',
        occurred_at: '2026-09-20T20:00:00',
        amount_value: 3,
        amount_unit: 'drinks',
        notes: null,
      }),
      true,
    );
    // Cross-patient update/delete affect zero rows.
    assert.equal(
      await updateSubstanceEntryDb(db, 'pat-B', id, {
        category: 'alcohol',
        label: 'x',
        occurred_at: '2026-09-20T20:00:00',
        amount_value: null,
        amount_unit: null,
        notes: null,
      }),
      false,
    );
    assert.equal(await deleteSubstanceEntryDb(db, 'pat-B', id), false);
    assert.equal(await deleteSubstanceEntryDb(db, 'pat-A', id), true);
    assert.equal((await listSubstanceEntriesDb(db, 'pat-A')).length, 0);
  });

  test('weekly summary counts real rows only (quiet days are zero)', () => {
    const points = summarizeSubstanceWeeks(
      [
        { occurred_at: '2026-09-20T19:30:00' },
        { occurred_at: '2026-09-20T21:00:00' },
        { occurred_at: '2026-09-18T12:00:00' },
        { occurred_at: 'garbage' },
      ],
      '2026-09-21',
      7,
    );
    assert.equal(points.length, 7);
    assert.equal(points[6].date, '2026-09-21');
    assert.equal(points.find((p) => p.date === '2026-09-20')?.count, 2);
    assert.equal(points.find((p) => p.date === '2026-09-19')?.count, 0);
  });
});

// ============================================================================
// Cycle tracking — real SQL + grouping + validation
// ============================================================================

describe('cycle tracking', () => {
  test('kinds and dates validate strictly', () => {
    assert.equal(isCycleKind('period-start'), true);
    assert.equal(isCycleKind('period-end'), true);
    assert.equal(isCycleKind('note'), true);
    assert.equal(isCycleKind('ovulation'), false);
    assert.equal(isCalendarDay('2026-09-21'), true);
    assert.equal(isCalendarDay('2026-13-40'), false);
    assert.equal(isCalendarDay('yesterday'), false);
    assert.throws(() => normalizeCycleInput({ kind: 'period-start', date: 'soon' }), /valid calendar date/);
    assert.throws(() => normalizeCycleInput({ kind: 'fertile-window', date: '2026-09-21' }), /Choose/);
  });

  test('CRUD round-trips with patient isolation', async () => {
    const db = makeDb();
    db.exec(CYCLE_DDL);
    const id = await insertCycleEntryDb(db, 'pat-A', {
      kind: 'period-start',
      date: '2026-09-01',
      notes: null,
    });
    assert.equal((await listCycleEntriesDb(db, 'pat-A')).length, 1);
    assert.equal((await listCycleEntriesDb(db, 'pat-B')).length, 0);
    assert.equal(
      await updateCycleEntryDb(db, 'pat-A', id, { kind: 'period-start', date: '2026-09-02', notes: 'late' }),
      true,
    );
    assert.equal(await updateCycleEntryDb(db, 'pat-B', id, { kind: 'note', date: '2026-09-02', notes: null }), false);
    assert.equal(await deleteCycleEntryDb(db, 'pat-B', id), false);
    assert.equal(await deleteCycleEntryDb(db, 'pat-A', id), true);
  });

  test('spans group starts into plain history (no predictions)', () => {
    const mk = (kind: CycleEntry['kind'], date: string, notes: string | null = null): CycleEntry => ({
      entry_id: `${kind}-${date}`,
      patient_id: 'pat-A',
      kind,
      date,
      notes,
      created_at: date,
    });
    const spans = groupCycleSpans([
      mk('note', '2026-08-28'),
      mk('period-start', '2026-09-01'),
      mk('period-end', '2026-09-05'),
      mk('period-start', '2026-09-29'),
    ]);
    assert.equal(spans.length, 3);
    // Newest first; middle span closed by the next recorded start.
    assert.equal(spans[0].start, '2026-09-29');
    assert.equal(spans[0].endExclusive, null);
    assert.equal(spans[1].start, '2026-09-01');
    assert.equal(spans[1].endExclusive, '2026-09-29');
    assert.equal(spans[1].entries.length, 2);
    assert.equal(spans[2].start, null);
  });

  test('migration 13 creates both tables through the real chain', async () => {
    const db = makeDb();
    await runMigrations(db as never);
    for (const table of ['substance_entries', 'cycle_entries']) {
      const found = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        table,
      );
      assert.equal(found.length, 1, table);
    }
  });
});

// ============================================================================
// Health areas — honest statuses from real inputs
// ============================================================================

describe('health areas', () => {
  const empty = {
    heartBpm: null,
    serverHeartBpm: null,
    loggedDays: 0,
    activeMedications: 0,
    documentCount: 0,
    substanceEntries: 0,
    cycleEntries: 0,
    profileWeightKg: null,
    activeDays7: 0,
    activitySessions7: 0,
    nutritionMeals7: 0,
    wellbeingDays7: 0,
  };

  test('empty inputs yield all no-data (never placeholders)', () => {
    const areas = buildHealthAreas(empty);
    assert.ok(areas.length >= 10);
    assert.ok(areas.every((a) => a.status === 'no-data'));
    assert.ok(areas.every((a) => a.source === 'none'));
  });

  test('device rows surface as device provenance; server fallback labeled', () => {
    const device = buildHealthAreas({ ...empty, heartBpm: 72.4, substanceEntries: 3, cycleEntries: 5 });
    assert.deepEqual(
      [device.find((a) => a.id === 'heart'), device.find((a) => a.id === 'substance'), device.find((a) => a.id === 'cycle')].map(
        (a) => [a?.status, a?.source, a?.headline],
      ),
      [
        ['available', 'device', '72 bpm'],
        ['available', 'device', '3 entries'],
        ['available', 'device', '5 entries'],
      ],
    );
    const server = buildHealthAreas({ ...empty, serverHeartBpm: 68 });
    const heart = server.find((a) => a.id === 'heart');
    assert.deepEqual([heart?.status, heart?.source], ['available', 'server']);
  });

  test('weight and skin honestly report no tracking', () => {
    const areas = buildHealthAreas({ ...empty, loggedDays: 9 });
    assert.equal(areas.find((a) => a.id === 'weight')?.status, 'no-data');
    assert.equal(areas.find((a) => a.id === 'skin')?.status, 'no-data');
    assert.equal(areas.find((a) => a.id === 'sleep')?.status, 'available');
  });
});

// ============================================================================
// 3D region mapping — known, unknown, node lookup
// ============================================================================

describe('body region mapping', () => {
  test('MVP ids resolve; unknown ids resolve to undefined (graceful)', () => {
    assert.ok(MVP_STRUCTURE_IDS.length > 0);
    const first = MVP_STRUCTURE_IDS[0];
    const mapping = getMapping(first);
    assert.ok(mapping !== undefined);
    assert.equal(getMapping('no-such-structure'), undefined);
  });

  test('node lookup returns mapped nodes; unknown nodes return empty', () => {
    const mapping = getMapping(MVP_STRUCTURE_IDS[0]);
    assert.ok(mapping !== undefined);
    const nodes = getStructuresForNode('definitely-not-a-mesh-node-xyz');
    assert.deepEqual(nodes, []);
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('batch 3 wiring', () => {
  test('tracker screens are device-only (no API imports)', () => {
    for (const rel of ['src/screens/Substance/SubstanceScreen.tsx', 'src/screens/Cycle/CycleScreen.tsx']) {
      const s = src(rel);
      assert.ok(!s.includes("from '@/services/api'"), `${rel}: no API import`);
      assert.ok(!s.includes('api.post(') && !s.includes('api.get('), `${rel}: no network calls`);
    }
  });

  test('body panel links regions with existing anatomical IDs', () => {
    const body = src('src/screens/Body/BodyScreen.tsx');
    assert.ok(body.includes("navigate('HealthGraph', { focusStructureId: id })"), 'graph link');
    assert.ok(body.includes('onViewGraph'), 'panel wiring');
  });

  test('routes and hub entry registered', () => {
    const types = src('src/types/index.ts');
    for (const route of ['HealthAreas', 'Substance', 'Cycle']) {
      assert.ok(types.includes(`${route}: undefined`), route);
    }
    const app = src('App.tsx');
    for (const route of ['HealthAreas', 'Substance', 'Cycle']) {
      assert.ok(app.includes(`name="${route}"`), route);
    }
    const settings = src('src/screens/Settings/SettingsScreen.tsx');
    assert.ok(settings.includes("navigate('HealthAreas')"), 'hub entry');
  });

  test('local wipe covers the new tables', () => {
    const erase = src('src/db/queries/patientErase.ts');
    assert.ok(erase.includes("'substance_entries'"), 'substance wiped');
    assert.ok(erase.includes("'cycle_entries'"), 'cycle wiped');
  });

  test('no treatment/prediction/diagnosis language', () => {
    // Instructional or predictive patterns (bare-word denials in comments
    // are documentation of the boundary, not violations).
    const substance = src('src/screens/Substance/SubstanceScreen.tsx').toLowerCase();
    for (const pattern of [
      'withdrawal symptoms',
      'withdrawal guide',
      'how to quit',
      'how to stop',
      'you should stop',
      'you should quit',
      'recommended dose',
      'treatment plan',
    ]) {
      assert.ok(!substance.includes(pattern), `substance: ${pattern}`);
    }
    const cycle = src('src/screens/Cycle/CycleScreen.tsx').toLowerCase();
    // Estimates are deliberate (period range + fertile window from recorded
    // starts); certainties and contraception/pregnancy uses stay banned.
    for (const pattern of [
      'ovulation day',
      'you are pregnant',
      'you are fertile',
      'will ovulate',
      'safe day',
      'infertile',
    ]) {
      assert.ok(!cycle.includes(pattern), `cycle: ${pattern}`);
    }
    assert.ok(cycle.includes('not for contraception'), 'cycle: contraception disclaimer');
    assert.ok(cycle.includes('estimat'), 'cycle: estimate framing');
    const areas = src('src/screens/HealthAreas/areas.ts').toLowerCase();
    assert.ok(!areas.includes('diagnos'), 'areas: diagnosis framing');
  });
});
