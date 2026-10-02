/**
 * dayOne — tests for the day-one starter strip (slice C).
 *
 * Behavioral coverage (pure, node-testable):
 *   - visibility matrix: fresh account shows; completed setup hides;
 *     medication row never asks for reminders before a medication exists
 *   - per-row status: done vs pending derived from real signals only
 * plus wiring guards (text-level, repo precedent):
 *   - strip requests no permissions itself (all permission surface lives
 *     in the destination screens)
 *   - dashboard renders the strip above the feed
 *   - no clinical/advisory language in the new copy
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/dayOne.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DAY_ONE_DISMISS_KEY,
  dayOneItems,
  isDayOneComplete,
} from '../src/services/dayOne.ts';

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

const FRESH = {
  loggedToday: false,
  medCount: 0,
  remindersOn: false,
  callEnabled: false,
  callTime: null,
};

const DONE = {
  loggedToday: true,
  medCount: 2,
  remindersOn: true,
  callEnabled: true,
  callTime: '20:00',
};

// ============================================================================
// Visibility matrix
// ============================================================================

describe('day-one visibility', () => {
  test('fresh account shows all three rows pending', () => {
    const items = dayOneItems(FRESH);
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => !i.done));
    assert.deepEqual(items.map((i) => i.id), ['checkin-call', 'med-reminders', 'voice-journal']);
  });

  test('completed setup hides the strip', () => {
    assert.equal(isDayOneComplete(dayOneItems(DONE)), true);
    assert.equal(isDayOneComplete(dayOneItems(FRESH)), false);
  });

  test('medication row never asks for reminders before a medication exists', () => {
    const [call, meds] = dayOneItems(FRESH);
    assert.equal(meds.done, false);
    assert.ok(!meds.status.toLowerCase().includes('notif'), 'no notification ask without meds');
    assert.ok(!meds.status.toLowerCase().includes('permission'), 'no permission ask without meds');
    const withMeds = dayOneItems({ ...FRESH, medCount: 1 });
    assert.equal(withMeds[1].done, false);
    const reminded = dayOneItems({ ...FRESH, medCount: 1, remindersOn: true });
    assert.equal(reminded[1].done, true);
  });

  test('dismiss key is versioned and namespaced', () => {
    assert.ok(DAY_ONE_DISMISS_KEY.startsWith('hg:'), 'namespaced key');
    assert.ok(DAY_ONE_DISMISS_KEY.includes('v1'), 'versioned key');
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('day-one wiring + copy guards', () => {
  test('strip requests no permissions itself', () => {
    const section = src('src/screens/Dashboard/DayOneSection.tsx');
    assert.ok(!section.includes('expo-notifications'), 'no notification SDK');
    assert.ok(!section.includes('requestReminderPermissions'), 'no permission calls');
    assert.ok(!section.includes('requestRecordingPermissionsAsync'), 'no mic calls');
  });

  test('dashboard renders the strip above the feed', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes('DayOneSection'), 'strip rendered');
    const stripIdx = dash.indexOf('<DayOneSection');
    const feedIdx = dash.indexOf('<CorrelationHeading');
    assert.ok(stripIdx !== -1 && feedIdx !== -1 && stripIdx < feedIdx, 'strip above feed');
  });

  test('strip deep-links the three destinations', () => {
    const section = src('src/screens/Dashboard/DayOneSection.tsx');
    assert.ok(section.includes("route: 'VoiceCheckin'"), 'check-in setup');
    assert.ok(section.includes("route: 'Medications'"), 'medications');
    assert.ok(section.includes("route: 'VoiceJournal'"), 'voice journal');
  });

  test('no clinical or advisory language in the new copy', () => {
    const hay = [
      src('src/services/dayOne.ts'),
      src('src/screens/Dashboard/DayOneSection.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
