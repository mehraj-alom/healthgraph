/**
 * bloodPressure — tests for BP logging + averages + neutral trends.
 *
 * Behavioral coverage (pure, node-testable):
 *   - BP recognition by LOINC (8480-6 / 8462-4) or mmHg unit; non-BP
 *     vitals rejected
 *   - daily pairing: latest systolic + latest diastolic per day; unpaired
 *     days skipped, never half-plotted
 *   - plausibility bounds (sys 50–300, dia 30–200, sys > dia); garbage
 *     dropped, never zero-filled
 *   - trailing-window averages with reading counts; empty windows yield
 *     honest nulls
 * plus wiring guards (text-level, repo precedent):
 *   - backend seed carries both BP concepts (idempotent upsert, no endpoint)
 *   - no staging/diagnostic language anywhere in the BP surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/bloodPressure.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  bpAverages,
  bpComponent,
  isBpReading,
  pairBpDays,
} from '../src/services/bloodPressure.ts';

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
function repo(rel: string): string {
  return fs.readFileSync(path.join(path.dirname(ROOT), rel), 'utf8');
}

// ============================================================================
// Recognition
// ============================================================================

describe('BP recognition', () => {
  test('LOINC codes and mmHg units count; other vitals do not', () => {
    assert.equal(isBpReading('8480-6', 'mmHg', 'systolic'), true);
    assert.equal(isBpReading('8462-4', 'mmhg', 'diastolic'), true);
    assert.equal(isBpReading(null, 'mmHg', null), true);
    assert.equal(isBpReading(null, 'mm Hg', null), true);
    assert.equal(isBpReading('29463-7', 'kg', null), false);
    assert.equal(isBpReading('2339-0', 'mg/dL', null), false);
    assert.equal(isBpReading(null, 'bpm', null), false);
  });

  test('component split: systolic vs diastolic vs neither', () => {
    assert.equal(bpComponent('8480-6', 'mmHg'), 'systolic');
    assert.equal(bpComponent('8462-4', 'mmHg'), 'diastolic');
    assert.equal(bpComponent(null, 'bpm'), null);
  });
});

// ============================================================================
// Pairing + bounds
// ============================================================================

const ROWS = [
  { log_date: '2026-09-28', concept_id: '8480-6', value: 128, unit: 'mmHg' },
  { log_date: '2026-09-28', concept_id: '8462-4', value: 82, unit: 'mmHg' },
  { log_date: '2026-09-29', concept_id: '8480-6', value: 300, unit: 'mmHg' },
  { log_date: '2026-09-29', concept_id: '8462-4', value: 310, unit: 'mmHg' },
  { log_date: '2026-09-30', concept_id: '8480-6', value: 122, unit: 'mmHg' },
  { log_date: '2026-10-01', concept_id: '8462-4', value: 80, unit: 'mmHg' },
  { log_date: '2026-10-01', concept_id: '8480-6', value: 118, unit: 'mmHg' },
  { log_date: '2026-10-01', concept_id: '8480-6', value: 124, unit: 'mmHg' },
];

describe('daily pairing', () => {
  test('latest sys + latest dia per day; unpaired and implausible dropped', () => {
    const pairs = pairBpDays(ROWS);
    assert.deepEqual(pairs, [
      { log_date: '2026-09-28', systolic: 128, diastolic: 82 },
      { log_date: '2026-10-01', systolic: 124, diastolic: 80 },
    ]);
  });
});

// ============================================================================
// Averages
// ============================================================================

describe('BP averages', () => {
  const PAIRS = [
    { log_date: '2026-09-26', systolic: 120, diastolic: 80 },
    { log_date: '2026-09-28', systolic: 128, diastolic: 82 },
    { log_date: '2026-10-01', systolic: 124, diastolic: 84 },
    { log_date: '2026-08-01', systolic: 140, diastolic: 90 },
  ];

  test('trailing-window means with counts', () => {
    const week = bpAverages(PAIRS, '2026-10-02', 7);
    assert.equal(week.count, 3);
    assert.equal(week.avgSystolic, 124);
    assert.equal(week.avgDiastolic, 82);
    const month = bpAverages(PAIRS, '2026-10-02', 90);
    assert.equal(month.count, 4);
  });

  test('empty windows yield honest nulls', () => {
    const none = bpAverages([], '2026-10-02', 7);
    assert.equal(none.count, 0);
    assert.equal(none.avgSystolic, null);
    assert.equal(none.avgDiastolic, null);
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('BP wiring + copy guards', () => {
  test('backend seed carries both BP concepts', () => {
    const seed = repo('services/ontology_seed.py');
    assert.ok(seed.includes('8480-6'), 'systolic concept seeded');
    assert.ok(seed.includes('8462-4'), 'diastolic concept seeded');
  });

  test('no staging or diagnostic language in the BP surface', () => {
    const hay = [
      src('src/services/bloodPressure.ts'),
      src('src/screens/VitalsLogger/VitalsLoggerScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'hypertension',
      'hypotension',
      'high blood pressure',
      'low blood pressure',
      'stage 1',
      'stage 2',
      'elevated',
      'crisis',
      'diagnos',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
