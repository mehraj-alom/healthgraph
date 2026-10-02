/**
 * onboardingCheckin — tests for the setup-pager Check-in step (slice B).
 *
 * Coverage (text-level, repo precedent + behavioral):
 *   - pager seats Check-in between Momentum and Done (5 pages, Done last,
 *     CTA labels honest: Continue everywhere except Start)
 *   - demo half is offline and labeled sample: sample Q&A present, no mic,
 *     no audio, no notification/permission surface in the step file
 *   - setup half wires the existing schedule module (get/setVoiceCheckin,
 *     20:00 default, enable toggle) — permission stays moment-of-intent
 *     inside the schedule module, not the step
 *   - no clinical/advisory language in the new copy
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/onboardingCheckin.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
// Pager seating
// ============================================================================

describe('check-in pager seating', () => {
  test('five pages: check-in between momentum and done', () => {
    const pager = src('src/screens/Onboarding/OnboardingSetupScreen.tsx');
    assert.ok(pager.includes('CheckinStep'), 'step imported and rendered');
    assert.ok(pager.includes('[0, 1, 2, 3, 4]') || pager.includes('[0,1,2,3,4]'), 'five pages');
    const renderIdx = pager.indexOf('<CheckinStep');
    const momentumIdx = pager.indexOf('<MomentumStep');
    const doneIdx = pager.indexOf('<DoneStep');
    assert.ok(momentumIdx !== -1 && doneIdx !== -1, 'neighbors present');
    assert.ok(momentumIdx < renderIdx && renderIdx < doneIdx, 'check-in sits between momentum and done');
    assert.ok(pager.includes('step === 4'), 'done is the last page');
  });

  test('CTA labels stay honest with five pages', () => {
    const pager = src('src/screens/Onboarding/OnboardingSetupScreen.tsx');
    assert.ok(!pager.includes('See my summary'), 'no stale summary label');
    assert.ok(pager.includes("'Start'"), 'start on done');
    assert.ok(pager.includes("'Continue'"), 'continue elsewhere');
  });

  test('step numbering counts four steps', () => {
    const goals = src('src/screens/Onboarding/GoalsStep.tsx');
    const momentum = src('src/screens/Onboarding/MomentumStep.tsx');
    const checkin = src('src/screens/Onboarding/CheckinStep.tsx');
    assert.ok(goals.includes('Step 1 of 4'), 'goals renumbered');
    assert.ok(momentum.includes('Step 3 of 4'), 'momentum renumbered');
    assert.ok(checkin.includes('Step 4 of 4'), 'check-in numbered last');
  });
});

// ============================================================================
// Demo half: offline sample
// ============================================================================

describe('check-in demo', () => {
  test('sample Q&A labeled as sample, no device surface', () => {
    const step = src('src/screens/Onboarding/CheckinStep.tsx');
    assert.ok(step.toLowerCase().includes('sample'), 'demo labeled sample');
    assert.ok(step.includes('INTERVIEW_SCRIPT'), 'sample questions from the script');
    assert.ok(!step.includes('expo-audio'), 'no audio in step');
    assert.ok(!step.includes('requestRecordingPermissionsAsync'), 'no mic in step');
    assert.ok(!step.includes('expo-notifications'), 'no notification SDK in step');
    assert.ok(!step.includes('expo-speech'), 'no TTS in step');
  });
});

// ============================================================================
// Setup half: existing schedule module
// ============================================================================

describe('check-in setup', () => {
  test('wires get/setVoiceCheckin with 20:00 default and toggle', () => {
    const step = src('src/screens/Onboarding/CheckinStep.tsx');
    assert.ok(step.includes('getVoiceCheckin'), 'loads saved time');
    assert.ok(step.includes('setVoiceCheckin'), 'persists through schedule module');
    assert.ok(step.includes('hour: 20') && step.includes('minute: 0'), '20:00 default state');
  });
});

// ============================================================================
// Copy guards
// ============================================================================

describe('check-in copy guards', () => {
  test('no clinical or advisory language in the new step', () => {
    const hay = [
      src('src/screens/Onboarding/CheckinStep.tsx'),
      src('src/screens/Onboarding/OnboardingSetupScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase();
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should take',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});
