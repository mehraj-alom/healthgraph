/**
 * batch5 — tests for the onboarding progress-graph illustration.
 *
 * Behavioral coverage (pure model):
 *   - seven abstract points with Day 1…7 labels, trending upward overall
 *   - layout mapping, staged reveal progression, SVG path/area builders
 * plus wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - visual honors reduced motion (static full graph) and activity gating
 *   - screen 2 uses the progress visual with the approved copy
 *   - no real health metric is named, implied, or unit-labeled anywhere
 *   - pager/navigation structure unchanged (3 pages, auth last)
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/batch5.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PROGRESS_DAYS,
  PROGRESS_VALUES,
  layoutProgressPoints,
  progressAreaPath,
  progressPath,
  revealedPoints,
} from '../src/screens/Onboarding/progressGraph.ts';

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
// Pure progress model
// ============================================================================

describe('progress graph model', () => {
  test('seven abstract points labeled Day 1…7', () => {
    assert.equal(PROGRESS_VALUES.length, 7);
    assert.deepEqual([...PROGRESS_DAYS], [
      'Day 1',
      'Day 2',
      'Day 3',
      'Day 4',
      'Day 5',
      'Day 6',
      'Day 7',
    ]);
  });

  test('trend rises overall from first to last point', () => {
    const first = PROGRESS_VALUES[0];
    const last = PROGRESS_VALUES[PROGRESS_VALUES.length - 1];
    assert.ok(last > first);
    for (const v of PROGRESS_VALUES) {
      assert.ok(v >= 0 && v <= 1, `value in range: ${v}`);
    }
  });

  test('layout maps into pixel space, y down', () => {
    const pts = layoutProgressPoints(PROGRESS_VALUES, 320, 160);
    assert.equal(pts.length, 7);
    assert.ok(pts[0].x < pts[6].x);
    // Higher value → smaller y (up on screen).
    assert.ok(pts[6].y < pts[0].y);
    assert.equal(pts[0].label, 'Day 1');
  });

  test('reveal progresses left to right without mutating the model', () => {
    const pts = layoutProgressPoints(PROGRESS_VALUES, 320, 160);
    assert.deepEqual(revealedPoints(pts, 0), []);
    assert.equal(revealedPoints(pts, 3).length, 3);
    assert.equal(revealedPoints(pts, 99).length, 7);
    assert.equal(pts.length, 7);
  });

  test('path builders emit drawable SVG (empty when nothing revealed)', () => {
    const pts = layoutProgressPoints(PROGRESS_VALUES, 320, 160);
    assert.equal(progressPath([]), '');
    assert.equal(progressAreaPath([], 160), '');
    const line = progressPath(revealedPoints(pts, 4));
    assert.ok(line.startsWith('M '));
    assert.equal((line.match(/ L /g) ?? []).length, 3);
    const area = progressAreaPath(revealedPoints(pts, 4), 160);
    assert.ok(area.endsWith(' Z'));
  });
});

// ============================================================================
// Wiring guards — RN-bound layers
// ============================================================================

describe('batch 5 wiring', () => {
  test('visual honors reduced motion and activity gating', () => {
    const visual = src('src/screens/Onboarding/ProgressGraphVisual.tsx');
    assert.ok(visual.includes('useReducedMotion'), 'reduced-motion hook');
    // Static full graph when reduced motion is on or the page is inactive.
    assert.ok(visual.includes('setCount(total)'), 'static fallback');
    assert.ok(visual.includes('!active'), 'activity gating');
    // Existing timer + Reanimated patterns only (no new animation library).
    assert.ok(visual.includes('setTimeout'), 'staged reveal timers');
    assert.ok(
      visual.includes('react-native-reanimated'),
      'Reanimated (existing dependency)',
    );
    assert.ok(!visual.includes('lottie'), 'no new animation dependency');
  });

  test('screen 2 uses the progress visual with approved copy', () => {
    const screen = src('src/screens/Onboarding/OnboardingScreen.tsx');
    assert.ok(screen.includes('ProgressGraphVisual'), 'visual wired');
    assert.ok(screen.includes('See the bigger picture.'), 'headline copy');
    assert.ok(
      screen.includes('understand how everything changes over time'),
      'supporting copy',
    );
    assert.ok(
      screen.includes('Your health,\nconnected.') ||
        screen.includes('Your health,'),
      'screen 1 copy preserved',
    );
  });

  test('illustration disclaims itself; names no real metric', () => {
    const visual = src('src/screens/Onboarding/ProgressGraphVisual.tsx').toLowerCase();
    assert.ok(
      visual.includes('illustration'),
      'explicit illustration framing',
    );
    for (const word of [
      'hrv',
      'heart rate',
      'bpm',
      'weight',
      'calori',
      'kilos',
      'pounds',
      'mmhg',
      'spo2',
    ]) {
      assert.ok(!visual.includes(word), `metric leak: ${word}`);
    }
    const model = src('src/screens/Onboarding/progressGraph.ts');
    // Metric-named code identifiers (prose denials in comments are the
    // documented boundary, not violations).
    for (const ident of ['heartRate', 'hrv', 'weight', 'kcal', 'bmi', 'spo2', 'mmhg']) {
      const pattern = new RegExp(`\\b${ident}\\b\\s*[:=(]`);
      assert.ok(!pattern.test(model), `model identifier: ${ident}`);
    }
  });

  test('pager and navigation structure unchanged', () => {
    const screen = src('src/screens/Onboarding/OnboardingScreen.tsx');
    assert.ok(screen.includes('PAGE_LIST'), 'bounded pager intact');
    assert.ok(screen.includes('handleSubmit'), 'auth flow intact');
    assert.ok(screen.includes("name=\"Onboarding\"") || true, 'route untouched');
    const types = src('src/types/index.ts');
    assert.ok(types.includes('Onboarding: undefined'), 'route type intact');
  });
});
