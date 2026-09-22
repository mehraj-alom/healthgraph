/**
 * changes — tests for deterministic quantified comparisons.
 *
 * Every number originates in the test's own fixtures (standing in for real
 * stored rows); the utility never fetches, synthesizes, or calls an LLM.
 * Covers: positive/negative percent, zero baseline, insufficient baseline,
 * identical periods, absolute-unit deltas, date boundaries, sparse data,
 * adherence math, week windows, and the no-interpretation copy rule.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/changes.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  adherencePercent,
  describeChange,
  inWindow,
  summarize,
  weekWindows,
} from '../src/screens/HealthAreas/changes.ts';

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

const LABEL = 'vs last week';

// ============================================================================
// Percentages from real aggregates
// ============================================================================

describe('describeChange percentages', () => {
  test('positive change renders an upward arrow with the period', () => {
    assert.equal(
      describeChange({
        current: summarize(Array(16).fill(1)),
        previous: summarize(Array(11).fill(1)),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      '↑ 45% vs last week',
    );
  });

  test('negative change renders a downward arrow', () => {
    assert.equal(
      describeChange({
        current: summarize([1, 1, 1]),
        previous: summarize([1, 1, 1, 1]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      '↓ 25% vs last week',
    );
  });

  test('sum mode compares totals (meals this week vs last)', () => {
    assert.equal(
      describeChange({
        current: summarize([2, 3, 2, 2, 3]),
        previous: summarize([3, 3, 3, 3, 4]),
        mode: 'sum',
        unit: '',
        periodLabel: LABEL,
      }),
      '↓ 25% vs last week',
    );
  });

  test('zero baseline never yields a percentage (no division by zero)', () => {
    assert.equal(
      describeChange({
        current: summarize([5]),
        previous: summarize([]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      null,
    );
    assert.equal(
      describeChange({
        current: summarize([0, 0]),
        previous: summarize([0, 0]),
        mode: 'average',
        unit: 'bpm',
        periodLabel: LABEL,
      }),
      null,
    );
  });

  test('insufficient baseline returns null (caller shows the absolute)', () => {
    assert.equal(
      describeChange({
        current: summarize([5, 6]),
        previous: summarize([]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
        minPrevious: 2,
      }),
      null,
    );
    // Default floor is a single baseline value.
    assert.notEqual(
      describeChange({
        current: summarize([5]),
        previous: summarize([4]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      null,
    );
  });

  test('identical periods describe no change, not a trend', () => {
    assert.equal(
      describeChange({
        current: summarize([4, 4]),
        previous: summarize([4, 4]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      '→ 0% vs last week',
    );
  });

  test('empty current period yields nothing to describe', () => {
    assert.equal(
      describeChange({
        current: summarize([]),
        previous: summarize([4]),
        mode: 'count',
        unit: '',
        periodLabel: LABEL,
      }),
      null,
    );
  });
});

// ============================================================================
// Absolute-unit deltas (units preserved, percentages avoided)
// ============================================================================

describe('describeChange absolute deltas', () => {
  test('heart rate uses signed bpm, never a percent', () => {
    assert.equal(
      describeChange({
        current: summarize([70, 72]),
        previous: summarize([75, 77]),
        mode: 'average',
        unit: 'bpm',
        periodLabel: LABEL,
        usePercent: false,
      }),
      '−5 bpm vs last week',
    );
  });

  test('sleep uses minutes with one-decimal precision under 10', () => {
    assert.equal(
      describeChange({
        current: summarize([480, 500]),
        previous: summarize([450, 458]),
        mode: 'average',
        unit: 'min',
        periodLabel: LABEL,
        usePercent: false,
      }),
      '+36 min vs last week',
    );
  });

  test('count metrics can also report absolute recording deltas', () => {
    assert.equal(
      describeChange({
        current: summarize([1, 1, 1, 1]),
        previous: summarize([1, 1, 1, 1, 1, 1, 1]),
        mode: 'count',
        unit: 'recordings',
        periodLabel: LABEL,
        usePercent: false,
      }),
      '−3 recordings vs last week',
    );
  });

  test('zero absolute delta is explicit, not silent', () => {
    assert.equal(
      describeChange({
        current: summarize([70]),
        previous: summarize([70]),
        mode: 'average',
        unit: 'bpm',
        periodLabel: LABEL,
        usePercent: false,
      }),
      '→ 0 bpm vs last week',
    );
  });
});

// ============================================================================
// Windows, summaries, sparse data, adherence
// ============================================================================

describe('windows and summaries', () => {
  test('week windows span month and year boundaries', () => {
    assert.deepEqual(weekWindows('2026-03-01'), {
      currentStart: '2026-02-23',
      currentEnd: '2026-03-01',
      previousStart: '2026-02-16',
      previousEnd: '2026-02-22',
    });
    assert.deepEqual(weekWindows('2026-01-01'), {
      currentStart: '2025-12-26',
      currentEnd: '2026-01-01',
      previousStart: '2025-12-19',
      previousEnd: '2025-12-25',
    });
  });

  test('window membership is inclusive on both ends', () => {
    assert.equal(inWindow('2026-09-15', '2026-09-15', '2026-09-21'), true);
    assert.equal(inWindow('2026-09-21', '2026-09-15', '2026-09-21'), true);
    assert.equal(inWindow('2026-09-14', '2026-09-15', '2026-09-21'), false);
  });

  test('summarize drops non-finite values; sparse single points still work', () => {
    assert.deepEqual(summarize([Number.NaN, 70, Number.POSITIVE_INFINITY]), {
      count: 1,
      sum: 70,
      avg: 70,
    });
    assert.deepEqual(summarize([]), { count: 0, sum: 0, avg: null });
    assert.equal(
      describeChange({
        current: summarize([72]),
        previous: summarize([70]),
        mode: 'average',
        unit: 'bpm',
        periodLabel: LABEL,
        usePercent: false,
      }),
      '+2 bpm vs last week',
    );
  });

  test('adherence is a plain rate over taken/(taken+missed+skipped)', () => {
    const statuses = [...Array(11).fill('TAKEN'), 'MISSED'] as string[];
    assert.deepEqual(adherencePercent(statuses), { text: 'Medication adherence: 92%' });
    assert.equal(adherencePercent([]), null);
    assert.equal(adherencePercent(['LATE']), null);
    // LATE is excluded from both sides of the fraction.
    assert.deepEqual(adherencePercent(['TAKEN', 'LATE']), { text: 'Medication adherence: 100%' });
  });
});

// ============================================================================
// Copy contract + wiring
// ============================================================================

describe('change copy contract', () => {
  test('outputs describe, never interpret', () => {
    const outputs = [
      describeChange({ current: summarize([8]), previous: summarize([4]), mode: 'count', unit: '', periodLabel: LABEL }),
      describeChange({ current: summarize([3]), previous: summarize([6]), mode: 'count', unit: '', periodLabel: LABEL }),
      describeChange({ current: summarize([70]), previous: summarize([75]), mode: 'average', unit: 'bpm', periodLabel: LABEL, usePercent: false }),
      adherencePercent(['TAKEN', 'TAKEN', 'MISSED'])?.text ?? '',
    ].join(' | ').toLowerCase();
    for (const word of [
      'improv', 'declin', 'good', 'bad', 'healthier', 'unhealthy',
      'risk', 'poor', 'better', 'worse', 'should',
    ]) {
      assert.ok(!outputs.includes(word), word);
    }
  });

  test('hook gates on patient identity and failure modes stay local', () => {
    const hook = src('src/hooks/useHealthChanges.ts');
    assert.ok(hook.includes('getCachedPatientId()'), 'patient scoping');
    assert.ok(hook.includes('if (!uid)'), 'logged-out empties');
    assert.ok(hook.includes('subscribeDataRefresh'), 'live propagation');
    assert.ok(!hook.includes('api.post(') && !hook.includes('api.get('), 'no network calls');
  });

  test('hub renders change lines without verdicts', () => {
    const hub = src('src/screens/HealthAreas/HealthAreasScreen.tsx');
    assert.ok(hub.includes('useHealthChanges()'), 'hook consumed');
    assert.ok(hub.includes('change={changes[area.id]'), 'line wired per area');
    const card = src('src/components/health/HealthAreaCard.tsx');
    assert.ok(card.includes('change?: string | null'), 'optional line prop');
  });
});
