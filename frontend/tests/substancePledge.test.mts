/**
 * substancePledge — tests for daily pledge + savings calculator.
 *
 * Behavioral coverage (pure, node-testable):
 *   - pledge normalization (valid day/category; reason trimmed/capped)
 *   - pledge streaks: consecutive days ending today, yesterday-grace
 *     while today is in progress, gaps break, future days ignored
 *   - hasPledgedToday
 *   - savings: days × spend from an anchor day; null without anchor
 *     or spend; status lines describe without judging
 * plus wiring guards (text-level, repo precedent):
 *   - stores use versioned keys, device-only (no tables, no network)
 *   - no treatment/clinical language anywhere in the pledge surface
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/substancePledge.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PLEDGE_STORAGE_KEY,
  SAVINGS_STORAGE_KEY,
  hasPledgedToday,
  normalizePledge,
  normalizeSavingsPlan,
  pledgeStreak,
  savingsSince,
  savingsStatusLine,
} from '../src/services/substancePledge.ts';

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
// Pledge normalization
// ============================================================================

describe('pledge normalization', () => {
  test('valid pledge passes with trimmed reason', () => {
    const out = normalizePledge({ category: 'alcohol', day: '2026-10-02', reason: '  clear mornings  ' });
    assert.equal(out.day, '2026-10-02');
    assert.equal(out.reason, 'clear mornings');
  });

  test('bad category or day throws; blank reason stays blank', () => {
    assert.throws(() => normalizePledge({ category: 'caffeine', day: '2026-10-02' }));
    assert.throws(() => normalizePledge({ category: 'alcohol', day: 'tomorrow' }));
    assert.throws(() => normalizePledge({ category: 'alcohol', day: null }));
    assert.equal(normalizePledge({ category: 'tobacco', day: '2026-10-02' }).reason, null);
  });
});

// ============================================================================
// Pledge streaks
// ============================================================================

const P = (category: string, day: string) => ({ category, day, reason: null });

describe('pledge streaks', () => {
  test('consecutive days ending today count; gaps break', () => {
    const pledges = [P('alcohol', '2026-09-30'), P('alcohol', '2026-10-01'), P('alcohol', '2026-10-02')];
    assert.equal(pledgeStreak(pledges, 'alcohol', '2026-10-02'), 3);
    const gapped = [P('alcohol', '2026-09-28'), P('alcohol', '2026-10-01'), P('alcohol', '2026-10-02')];
    assert.equal(pledgeStreak(gapped, 'alcohol', '2026-10-02'), 2);
  });

  test('today in progress: streak stands on yesterday', () => {
    const pledges = [P('alcohol', '2026-09-30'), P('alcohol', '2026-10-01')];
    assert.equal(pledgeStreak(pledges, 'alcohol', '2026-10-02'), 2);
    assert.equal(hasPledgedToday(pledges, 'alcohol', '2026-10-02'), false);
    assert.equal(hasPledgedToday([...pledges, P('alcohol', '2026-10-02')], 'alcohol', '2026-10-02'), true);
  });

  test('other categories and future days never count', () => {
    const pledges = [P('tobacco', '2026-10-02'), P('alcohol', '2026-10-05')];
    assert.equal(pledgeStreak(pledges, 'alcohol', '2026-10-02'), 0);
    assert.equal(pledgeStreak([], 'alcohol', '2026-10-02'), 0);
  });
});

// ============================================================================
// Savings
// ============================================================================

describe('savings calculator', () => {
  test('days times spend from the anchor day', () => {
    const out = savingsSince('2026-09-01', 12.5, '2026-10-02');
    assert.equal(out?.days, 31);
    assert.equal(out?.total, 387.5);
  });

  test('null without anchor or spend; bad plans rejected', () => {
    assert.equal(savingsSince(null, 12.5, '2026-10-02'), null);
    assert.equal(savingsSince('2026-09-01', null, '2026-10-02'), null);
    assert.equal(savingsSince('2026-10-05', 12.5, '2026-10-02'), null);
    assert.throws(() => normalizeSavingsPlan({ category: 'alcohol', amountPerDay: -3 }));
    assert.throws(() => normalizeSavingsPlan({ category: 'alcohol', amountPerDay: NaN }));
    const plan = normalizeSavingsPlan({ category: 'tobacco', amountPerDay: 8, currency: ' € ' });
    assert.equal(plan.amountPerDay, 8);
    assert.equal(plan.currency, '€');
  });

  test('status lines describe without judging', () => {
    assert.equal(
      savingsStatusLine({ days: 31, total: 387.5 }, '$'),
      '≈ $387.50 not spent · 31 days',
    );
    assert.equal(savingsStatusLine(null, '$'), 'Add your typical spend to see savings');
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('pledge wiring + copy guards', () => {
  test('versioned keys; stores use storage only, no tables or network', () => {
    assert.ok(PLEDGE_STORAGE_KEY.startsWith('hg:'), 'namespaced key');
    assert.ok(SAVINGS_STORAGE_KEY.startsWith('hg:'), 'namespaced key');
    const wiring = src('src/services/substancePledgeStore.ts');
    assert.ok(!wiring.includes('CREATE TABLE'), 'no schema');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
  });

  test('no treatment language anywhere in the pledge surface', () => {
    // New modules are fully controlled: bare clinical words stay out.
    const modules = [
      src('src/services/substancePledge.ts'),
      src('src/services/substancePledgeStore.ts'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of ['treatment', 'therapy', 'withdrawal', 'detox', 'addiction', 'alcoholic', 'cure', 'relapse', 'disorder', 'diagnos']) {
      assert.ok(!modules.includes(phrase), phrase);
    }
    // The screen carries documented boundary denials ("tracking, NOT
    // treatment"), so it is scanned for instructional patterns instead.
    const screen = src('src/screens/Substance/SubstanceScreen.tsx').toLowerCase();
    for (const phrase of [
      'you should stop',
      'you should quit',
      'how to quit',
      'how to stop',
      'treatment plan',
      'withdrawal symptoms',
      'relapse',
    ]) {
      assert.ok(!screen.includes(phrase), phrase);
    }
  });
});
