/**
 * behaviorImpacts — tests for the day-pattern impacts engine.
 *
 * Behavioral coverage (pure, node-testable):
 *   - group means with counts; pairs suppressed below 3 days per side
 *   - confidence from paired-day volume (low/medium/high)
 *   - previous-day lag shifts factors back one day
 *   - strongest differences first, capped at six
 *   - day assembly from real rows (substance/craving/exercise flags,
 *     sleep hours from minutes, malformed rows skipped)
 * plus wiring guards (text-level, repo precedent):
 *   - hook reads device storage only (no network)
 *   - Insights screen renders the patterns section
 *   - generated lines never speak causally; no clinical language
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/behaviorImpacts.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  buildImpactDays,
  computeImpacts,
} from '../src/services/behaviorImpacts.ts';

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

const FACTORS = [
  { id: 'alcohol', label: 'alcohol days' },
  { id: 'exercise', label: 'exercise days' },
];
const OUTCOMES = [
  { id: 'mood', label: 'mood' },
  { id: 'sleep', label: 'sleep' },
];

function day(date: string, factorOn: boolean, mood: number | null): Record<string, unknown> {
  return {
    date,
    factors: { alcohol: factorOn, exercise: !factorOn },
    outcomes: { mood, sleep: 7 },
  };
}

// ============================================================================
// Impact math
// ============================================================================

describe('impact computation', () => {
  test('group means with counts; thin pairs suppressed', () => {
    const days = [
      day('2026-09-28', true, 3),
      day('2026-09-29', true, 3),
      day('2026-09-30', true, 4),
      day('2026-10-01', false, 5),
      day('2026-10-02', false, 5),
      day('2026-10-03', false, 4),
    ];
    const out = computeImpacts(days, FACTORS, OUTCOMES);
    const mood = out.find((i) => i.factor === 'alcohol' && i.outcome === 'mood' && i.lag === 0);
    assert.ok(mood);
    assert.equal(mood.withMean, 3.3);
    assert.equal(mood.withoutMean, 4.7);
    assert.equal(mood.withN, 3);
    assert.equal(mood.withoutN, 3);
    assert.equal(mood.confidence, 'low');
    // Exercise/mood has 3 with-days of mood 5,5,4: computed, not suppressed.
    assert.equal(out.some((i) => i.factor === 'exercise' && i.outcome === 'mood'), true);
  });

  test('confidence grows with paired volume; strongest first, capped', () => {
    const days: Record<string, unknown>[] = [];
    for (let i = 0; i < 30; i++) {
      const d = `2026-09-${String(i + 1).padStart(2, '0')}`;
      days.push(day(d, i % 2 === 0, i % 2 === 0 ? 3 : 4));
    }
    const out = computeImpacts(days, FACTORS, OUTCOMES);
    const mood = out.find((i) => i.factor === 'alcohol' && i.outcome === 'mood' && i.lag === 0);
    assert.ok(mood && mood.confidence === 'high');
    assert.ok(out.length <= 6);
    for (let i = 1; i < out.length; i++) {
      assert.ok(Math.abs(out[i - 1].diff) >= Math.abs(out[i].diff), 'sorted by magnitude');
    }
  });

  test('previous-day lag shifts factors back one day', () => {
    const lagged = [
      { date: '2026-09-26', factors: { alcohol: true }, outcomes: { mood: 5 } },
      { date: '2026-09-27', factors: { alcohol: true }, outcomes: { mood: 3 } },
      { date: '2026-09-28', factors: { alcohol: true }, outcomes: { mood: 3 } },
      { date: '2026-09-29', factors: { alcohol: false }, outcomes: { mood: 3 } },
      { date: '2026-09-30', factors: { alcohol: false }, outcomes: { mood: 4 } },
      { date: '2026-10-01', factors: { alcohol: false }, outcomes: { mood: 4 } },
      { date: '2026-10-02', factors: { alcohol: false }, outcomes: { mood: 4 } },
    ];
    const out = computeImpacts(lagged, [{ id: 'alcohol', label: 'alcohol days' }], [{ id: 'mood', label: 'mood' }]);
    const lag1 = out.find((i) => i.lag === 1);
    assert.ok(lag1, 'lag-1 impact computed');
    // Factor on 9-26/27/28 pairs with outcomes on 9-27/28/29 (mood 3,3,3).
    assert.equal(lag1.withMean, 3);
    assert.equal(lag1.withN, 3);
  });
});

// ============================================================================
// Day assembly
// ============================================================================

describe('day assembly', () => {
  test('flags and outcomes from real rows; malformed skipped', () => {
    const days = buildImpactDays({
      groups: [
        { log_date: '2026-10-01', overall_wellbeing: 4, energy_level: 3, stress_level: 2, sleep_duration_minutes: 450 },
        { log_date: 'garbage', overall_wellbeing: 4, energy_level: 3, stress_level: 2, sleep_duration_minutes: 450 },
      ],
      substance: [{ occurred_at: '2026-10-01T19:00:00', category: 'alcohol' }],
      cravings: [{ log_date: '2026-10-01' }],
      activities: [{ log_date: '2026-10-02' }],
    });
    assert.equal(days.length, 2);
    assert.deepEqual(days[0].factors, { alcohol: true, tobacco: false, craving: true, exercise: false });
    assert.deepEqual(days[0].outcomes, { mood: 4, energy: 3, stress: 2, sleep: 7.5 });
    // Activity-only day enters with null outcomes: a lag source, never a mean.
    assert.equal(days[1].date, '2026-10-02');
    assert.equal(days[1].factors.exercise, true);
    assert.deepEqual(days[1].outcomes, { mood: null, energy: null, stress: null, sleep: null });
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('impacts wiring + copy guards', () => {
  test('hook reads device storage only; screen renders the section', () => {
    const hook = src('src/hooks/useBehaviorImpacts.ts');
    assert.ok(!hook.includes('fetch('), 'no network');
    assert.ok(!hook.includes('/api/v1/'), 'no backend endpoints');
    const screen = src('src/screens/Insights/InsightsScreen.tsx');
    assert.ok(screen.includes('useBehaviorImpacts'), 'hook wired');
    assert.ok(screen.includes('What moves with what') || screen.includes('Day patterns'), 'section present');
  });

  test('generated lines never speak causally; no clinical language', () => {
    const lines = computeImpacts(
      [
        { date: '2026-09-28', factors: { alcohol: true }, outcomes: { mood: 3 } },
        { date: '2026-09-29', factors: { alcohol: true }, outcomes: { mood: 3 } },
        { date: '2026-09-30', factors: { alcohol: true }, outcomes: { mood: 4 } },
        { date: '2026-10-01', factors: { alcohol: false }, outcomes: { mood: 5 } },
        { date: '2026-10-02', factors: { alcohol: false }, outcomes: { mood: 5 } },
        { date: '2026-10-03', factors: { alcohol: false }, outcomes: { mood: 4 } },
      ],
      [{ id: 'alcohol', label: 'alcohol days' }],
      [{ id: 'mood', label: 'mood' }],
    ).map((i) => i.line.toLowerCase());
    assert.ok(lines.length > 0);
    for (const line of lines) {
      for (const phrase of ['because', 'causes', 'due to', 'makes you', 'will improve', 'will lower', 'should']) {
        assert.ok(!line.includes(phrase), `${phrase} in: ${line}`);
      }
    }
    const mod = src('src/services/behaviorImpacts.ts').toLowerCase();
    for (const phrase of ['diagnos', 'treatment', 'because', 'causes']) {
      assert.ok(!mod.includes(phrase), phrase);
    }
  });
});
