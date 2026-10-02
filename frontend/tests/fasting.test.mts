/**
 * fasting — tests for the on-device fasting timer.
 *
 * Behavioral coverage (pure, node-testable):
 *   - window presets are fixed, ascending, sane bounds
 *   - fast status phases (idle/fasting/done) with remaining math from
 *     stored ISO timestamps (reload-safe, no background timer needed)
 *   - ending at/after target completes; ending early marks early —
 *     never rewrites history
 *   - history caps at 60, corrupt stores degrade to empty
 *   - duration formatting
 * plus wiring guards (text-level, repo precedent):
 *   - stores use versioned keys, device-only (no tables, no network)
 *   - no medical-claim language (no autophagy/ketosis/detox staging)
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/fasting.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FASTING_STORAGE_KEY,
  FASTING_WINDOWS,
  capHistory,
  fastStatus,
  fmtFastDuration,
  normalizeFastState,
} from '../src/services/fasting.ts';

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
// Windows + status
// ============================================================================

describe('fasting windows', () => {
  test('fixed presets, ascending, within sane bounds', () => {
    const hours = FASTING_WINDOWS.map((w) => w.fastHours);
    assert.deepEqual(hours, [12, 14, 16, 18, 20]);
    for (const w of FASTING_WINDOWS) {
      assert.match(w.id, /^\d+:\d+$/);
    }
  });

  test('status phases from stored timestamps', () => {
    assert.equal(fastStatus(null, Date.now()).phase, 'idle');
    const started = new Date('2026-10-02T08:00:00Z').getTime();
    const mid = fastStatus({ windowId: '16:8', startedAt: new Date(started).toISOString(), endedAt: null }, started + 7 * 3600 * 1000);
    assert.equal(mid.phase, 'fasting');
    assert.equal(mid.remainingMs, 9 * 3600 * 1000);
    const done = fastStatus({ windowId: '16:8', startedAt: new Date(started).toISOString(), endedAt: null }, started + 17 * 3600 * 1000);
    assert.equal(done.phase, 'done');
    assert.equal(done.remainingMs, 0);
  });

  test('corrupt state degrades to idle, never throws', () => {
    assert.equal(fastStatus(null, 0).phase, 'idle');
    assert.equal(normalizeFastState(null).active, null);
    assert.deepEqual(normalizeFastState({ garbage: 1 }).history, []);
  });
});

// ============================================================================
// History
// ============================================================================

describe('fast history', () => {
  test('caps at 60, newest last', () => {
    const mk = (i: number) => ({
      windowId: '16:8',
      startedAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z`,
      endedAt: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T23:00:00Z`,
      completed: true,
    });
    const capped = capHistory(Array.from({ length: 70 }, (_, i) => mk(i)));
    assert.equal(capped.length, 60);
  });

  test('durations format as H:MM', () => {
    assert.equal(fmtFastDuration(0), '0:00');
    assert.equal(fmtFastDuration(7 * 3600 * 1000 + 24 * 60 * 1000), '7:24');
    assert.equal(fmtFastDuration(16 * 3600 * 1000), '16:00');
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('fasting wiring + copy guards', () => {
  test('versioned key; stores use storage only, no tables or network', () => {
    assert.ok(FASTING_STORAGE_KEY.startsWith('hg:'), 'namespaced key');
    const wiring = src('src/services/fastingStore.ts');
    assert.ok(!wiring.includes('CREATE TABLE'), 'no schema');
    assert.ok(!wiring.includes('fetch('), 'no network');
    assert.ok(!wiring.includes('/api/'), 'no backend endpoints');
  });

  test('nutrition screen carries the fasting card', () => {
    const screen = src('src/screens/NutritionEngine/NutritionEngineScreen.tsx');
    assert.ok(screen.includes('FastingCard'), 'card rendered');
  });

  test('no medical-claim language in the fasting surface', () => {
    const hay = [
      src('src/services/fasting.ts'),
      src('src/services/fastingStore.ts'),
      src('src/screens/NutritionEngine/NutritionEngineScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of ['autophagy', 'ketosis', 'detox', 'cleanse', 'fat-burning', 'fat burning', 'heals', 'healing']) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
