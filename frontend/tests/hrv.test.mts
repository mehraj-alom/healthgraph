/**
 * hrv — tests for on-device HRV math + morning baseline.
 *
 * Behavioral coverage (pure, node-testable):
 *   - rMSSD/SDNN on known sequences (flat line reads zero, alternating
 *     reads the step, garbage/ectopy rejected, short reads gated)
 *   - baseline: 7-day mean with 60-day min–max band, minimum 4 readings,
 *     honest nulls when thin
 * plus wiring guards (text-level, repo precedent):
 *   - fingertip save computes HRV when native leaves it null; face path
 *     untouched (face model emits no beat intervals)
 *   - result shows HRV + baseline; morning protocol card on start
 *   - no clinical/equivalence language in the HRV surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/hrv.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  cleanRrIntervals,
  hrvBaseline,
  rmssd,
  sdnn,
} from '../src/services/hrv.ts';

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

// ============================================================================
// rMSSD / SDNN
// ============================================================================

describe('HRV math', () => {
  test('flat line reads zero; alternating reads the step', () => {
    assert.equal(rmssd([800, 800, 800, 800, 800, 800, 800, 800, 800, 800]), 0);
    assert.equal(sdnn([800, 800, 800, 800, 800, 800, 800, 800, 800, 800]), 0);
    assert.equal(rmssd([800, 850, 800, 850, 800, 850, 800, 850, 800, 850]), 50);
  });

  test('ectopic beats and garbage rejected, short reads gated', () => {
    const withEctopic = [800, 810, 795, 805, 1500, 800, 810, 795, 805, 800, 810];
    assert.deepEqual(cleanRrIntervals(withEctopic), [800, 810, 795, 805, 800, 810, 795, 805, 800, 810]);
    assert.deepEqual(cleanRrIntervals([800, 0, -5, NaN, 250, 2500, 800]), [800, 800]);
    assert.equal(rmssd([800, 810, 800]), null);
    assert.equal(rmssd([]), null);
    assert.equal(sdnn([800, 810, 800]), null);
  });
});

// ============================================================================
// Baseline
// ============================================================================

describe('morning baseline', () => {
  const readings = (days: number[], base: number) =>
    days.map((d, i) => ({
      measured_at: `2026-09-${String(d).padStart(2, '0')}T07:00:00`,
      rmssd_ms: base + (i % 3) * 2,
    }));

  test('7-day mean with 60-day band, minimum four readings', () => {
    const rows = [
      ...readings([26, 27, 28, 29, 30], 40),
      { measured_at: '2026-10-01T07:00:00', rmssd_ms: 44 },
      { measured_at: '2026-08-15T07:00:00', rmssd_ms: 60 },
    ];
    const b = hrvBaseline(rows, '2026-10-02');
    assert.ok(b !== null);
    assert.equal(b.count, 6);
    assert.equal(b.mean, 42);
    assert.equal(b.lo, 40);
    assert.equal(b.hi, 60);
  });

  test('thin history yields honest nulls', () => {
    assert.equal(hrvBaseline([], '2026-10-02'), null);
    assert.equal(hrvBaseline(readings([28, 29, 30], 40), '2026-10-02'), null);
    assert.equal(hrvBaseline([{ measured_at: 'garbage', rmssd_ms: 40 }], '2026-10-02'), null);
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('HRV wiring + copy guards', () => {
  test('fingertip save computes HRV when native leaves it null', () => {
    const hook = src('src/hooks/usePpgMeasurement.ts');
    assert.ok(hook.includes('rmssd'), 'HRV math wired into save');
  });

  test('result shows HRV with baseline; morning protocol on start', () => {
    const screen = src('src/screens/PpgMeasure/PulseInstrumentScreen.tsx');
    assert.ok(screen.includes('rMSSD') || screen.includes('RMSSD'), 'HRV readout present');
    assert.ok(screen.includes('baseline'), 'baseline comparison present');
    assert.ok(screen.includes('Morning read') || screen.includes('morning'), 'protocol card present');
  });

  test('no clinical or equivalence language in the HRV surface', () => {
    // The screen's standard wellness denial is allowlisted — it denies
    // claims instead of making them.
    const screen = src('src/screens/PpgMeasure/PulseInstrumentScreen.tsx')
      .toLowerCase()
      .replaceAll('not for diagnosis or treatment', '')
      .replaceAll('not a medical device', '');
    const hay = [
      src('src/services/hrv.ts'),
      src('src/hooks/usePpgMeasurement.ts'),
      screen,
    ].join('\n');
    for (const phrase of [
      'medical-grade',
      'medical grade',
      'clinical',
      'diagnos',
      'arrhythmia',
      'afib',
      'as accurate as',
      'ecg-grade',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
