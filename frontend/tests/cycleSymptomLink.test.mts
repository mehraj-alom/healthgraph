/**
 * cycleSymptomLink.test.mts — cycle-phase symptom patterns (node).
 *
 * Co-occurrence counts only: which logged symptoms fall in which cycle
 * phase across recent cycles, always with the cycle basis attached.
 * No causal language, no condition labels, no predictions of future
 * symptoms — a symptom on a date is assigned to a phase or left out.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPatternLines,
  PHASES,
  phaseOf,
  summarizeCyclePatterns,
} from '../src/services/cycleSymptomLink.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 28-day cycles starting 2026-08-26 and 2026-09-23.
const STARTS = ['2026-08-26', '2026-09-23'];

describe('phase assignment', () => {
  test('four phases across a 28-day cycle', () => {
    assert.equal(phaseOf('2026-09-23', STARTS, 28), 'menstrual');
    assert.equal(phaseOf('2026-09-27', STARTS, 28), 'menstrual');
    assert.equal(phaseOf('2026-09-28', STARTS, 28), 'follicular');
    assert.equal(phaseOf('2026-10-02', STARTS, 28), 'fertile');
    assert.equal(phaseOf('2026-10-07', STARTS, 28), 'fertile');
    assert.equal(phaseOf('2026-10-08', STARTS, 28), 'luteal');
    assert.equal(phaseOf('2026-10-09', STARTS, 28), 'luteal');
    assert.equal(phaseOf('2026-10-20', STARTS, 28), 'luteal');
  });

  test('dates before any start, gaps over 90 days, and insane lengths stay out', () => {
    assert.equal(phaseOf('2026-08-01', STARTS, 28), null);
    assert.equal(phaseOf('2027-06-01', STARTS, 28), null);
    assert.equal(phaseOf('2026-09-25', STARTS, 10), null);
    assert.equal(phaseOf('2026-09-25', STARTS, 45), null);
    assert.equal(phaseOf('garbage', STARTS, 28), null);
    assert.equal(phaseOf('2026-09-25', [], 28), null);
  });

  test('phase labels are the fixed four', () => {
    assert.deepEqual(PHASES, ['menstrual', 'follicular', 'fertile', 'luteal']);
  });
});

describe('pattern summaries', () => {
  const occ = (date: string, label: string) => ({ date, label });

  test('counts co-occurrence per phase with the cycle basis attached', () => {
    const out = summarizeCyclePatterns(
      [
        occ('2026-10-10', 'Headache'),
        occ('2026-10-11', 'Headache'),
        occ('2026-09-12', 'Headache'),
        occ('2026-10-10', 'Nausea'),
        occ('2026-09-25', 'Nausea'),
      ],
      STARTS,
      28,
    );
    assert.equal(out.cycles, 2);
    const headache = out.patterns.find((p) => p.label === 'Headache');
    assert.deepEqual(headache?.perPhase, { menstrual: 0, follicular: 0, fertile: 0, luteal: 3 });
    assert.equal(headache?.cycles, 2);
    const nausea = out.patterns.find((p) => p.label === 'Nausea');
    assert.deepEqual(nausea?.perPhase, { menstrual: 1, follicular: 0, fertile: 0, luteal: 1 });
  });

  test('empty or phaseless input yields no patterns, never zeros-as-claims', () => {
    assert.deepEqual(summarizeCyclePatterns([], STARTS, 28).patterns, []);
    assert.deepEqual(
      summarizeCyclePatterns([occ('2026-01-01', 'Headache')], STARTS, 28).patterns,
      [],
    );
  });

  test('one line per symptom-phase with the basis in the copy', () => {
    const out = summarizeCyclePatterns([occ('2026-10-10', 'Headache')], STARTS, 28);
    assert.ok(out.lines.length > 0);
    assert.ok(out.lines[0].includes('Headache'));
    assert.ok(out.lines[0].includes('2 cycles') || out.lines[0].includes('last 2'));
  });
});

describe('pattern copy guards', () => {
  test('no causal, diagnostic, or condition language', () => {
    // The standard wellness disclaimer ("not medical advice, diagnosis, or
    // treatment") is allowlisted — it denies claims instead of making them.
    const hay = [
      src('src/services/cycleSymptomLink.ts'),
      src('src/screens/Cycle/CycleScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase()
      .replaceAll('not medical advice, diagnosis, or treatment', '');
    for (const phrase of [
      'causes',
      'because',
      'due to',
      'triggered by',
      'leads to',
      'pms',
      'pmdd',
      'you have',
      'diagnos',
      'disorder',
      'syndrome',
      'will occur',
      'predicts your',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});

describe('buildPatternLines display assembly', () => {
  const STARTS = ['2026-08-26', '2026-09-23'];
  const OCC = [
    { date: '2026-09-03', label: 'Cramps' },
    { date: '2026-09-04', label: 'Cramps' },
    { date: '2026-09-24', label: 'Headache' },
    { date: '2026-10-03', label: 'Headache' },
    { date: '2026-10-04', label: 'Headache' },
  ];

  test('returns top lines with basis, capped at six', () => {
    const lines = buildPatternLines(OCC, STARTS, 28);
    assert.ok(Array.isArray(lines) && lines.length > 0);
    assert.ok(lines.length <= 6);
    for (const line of lines) assert.match(line, /last 2 cycles/);
  });

  test('null when starts are thin or nothing co-occurs', () => {
    assert.equal(buildPatternLines(OCC, ['2026-09-23'], 28), null);
    assert.equal(buildPatternLines([], STARTS, 28), null);
    assert.equal(
      buildPatternLines([{ date: '2026-07-01', label: 'Cramps' }], STARTS, 28),
      null,
    );
  });
});
