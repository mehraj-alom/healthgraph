/**
 * voiceCheckinFallback — tests for the STT-down path (slice A1).
 *
 * Behavioral coverage (pure, node-testable):
 *   - outage routing: MODEL_UNAVAILABLE apologizes; transient codes
 *     (TRANSCRIPTION_FAILED, TIMEOUT) keep retry behavior; permission
 *     and audio problems never count as outages
 *   - outage log: appends structured markers, caps the list, tolerates
 *     corrupt stores, carries no PII (keys pinned)
 *   - manual entry reuses the interview parsers: typed numbers validate
 *     with the same bounds, blanks stay missing
 * plus wiring guards (text-level, repo precedent):
 *   - VoiceCheckinScreen routes MODEL_UNAVAILABLE to an apology mode
 *     with manual entry, marks the outage, and pins the "working on it"
 *     copy — without adding network surface
 *   - no clinical/advisory language in the new copy
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/voiceCheckinFallback.test.mts
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  appendOutage,
  isSttOutage,
  OUTAGE_KIND,
  parseOutageLog,
} from '../src/services/voice/outageLog.ts';
import { INTERVIEW_SCRIPT } from '../src/services/voiceCheckin/questions.ts';

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
// Outage routing
// ============================================================================

describe('STT outage routing', () => {
  test('only MODEL_UNAVAILABLE counts as an outage', () => {
    assert.equal(isSttOutage('MODEL_UNAVAILABLE'), true);
    assert.equal(isSttOutage('TRANSCRIPTION_FAILED'), false);
    assert.equal(isSttOutage('TIMEOUT'), false);
    assert.equal(isSttOutage('INVALID_AUDIO'), false);
    assert.equal(isSttOutage('INVALID_INPUT'), false);
    assert.equal(isSttOutage('INTERRUPTED'), false);
    assert.equal(isSttOutage('whatever' as never), false);
  });

  test('outage kind is namespaced', () => {
    assert.ok(OUTAGE_KIND.startsWith('voice_'));
  });
});

// ============================================================================
// Outage log
// ============================================================================

describe('outage log', () => {
  test('appends markers newest-last with a cap', () => {
    let entries = appendOutage([], { kind: OUTAGE_KIND, code: 'MODEL_UNAVAILABLE', at: '2026-10-02T10:00:00' });
    assert.equal(entries.length, 1);
    for (let i = 0; i < 60; i++) {
      entries = appendOutage(entries, { kind: OUTAGE_KIND, code: 'MODEL_UNAVAILABLE', at: `2026-10-02T10:${String(i).padStart(2, '0')}:00` });
    }
    assert.equal(entries.length, 50);
    assert.equal(entries[entries.length - 1].at, '2026-10-02T10:59:00');
  });

  test('corrupt stores parse to empty, never throw', () => {
    assert.deepEqual(parseOutageLog(null), []);
    assert.deepEqual(parseOutageLog('not json'), []);
    assert.deepEqual(parseOutageLog(JSON.stringify({ nope: 1 })), []);
    assert.deepEqual(
      parseOutageLog(JSON.stringify([{ kind: OUTAGE_KIND, code: 'MODEL_UNAVAILABLE', at: 'x' }])),
      [{ kind: OUTAGE_KIND, code: 'MODEL_UNAVAILABLE', at: 'x' }],
    );
  });

  test('markers carry no PII: keys pinned', () => {
    const [entry] = appendOutage([], { kind: OUTAGE_KIND, code: 'MODEL_UNAVAILABLE', at: '2026-10-02T10:00:00' });
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'code', 'kind']);
  });
});

// ============================================================================
// Manual entry reuses interview parsers
// ============================================================================

describe('manual entry validation', () => {
  test('typed numbers validate with interview bounds', () => {
    const [mood, , , sleep, water] = INTERVIEW_SCRIPT;
    assert.equal(mood.parse('4'), 4);
    assert.equal(mood.parse('0'), null);
    assert.equal(mood.parse(''), null);
    assert.equal(sleep.parse('7.5'), 7.5);
    assert.equal(sleep.parse('99'), null);
    assert.equal(water.parse('3'), 3);
    assert.equal(water.parse(''), null);
  });
});

// ============================================================================
// Wiring + copy guards
// ============================================================================

describe('apology wiring + copy guards', () => {  test('screen routes STT outage to apology mode with manual entry', () => {
    const screen = src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx');
    assert.ok(screen.includes("'apology'"), 'apology mode exists');
    assert.ok(screen.includes('isSttOutage'), 'outage router wired');
    assert.ok(screen.includes('markSttOutage'), 'outage marked');
    assert.ok(screen.includes('working on it'), 'working-on-it copy pinned');
    assert.ok(screen.includes('enter your answers below'), 'manual entry offered');
  });

  test('no clinical or advisory language in the fallback surface', () => {
    const hay = [
      src('src/services/voice/outageLog.ts'),
      src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx'),
    ]
      .join('\n')
      .toLowerCase()
      .replaceAll('not medical advice', '');
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should take',
      'prescribes',
      'increase your dose',
    ]) {
      assert.ok(!hay.includes(phrase), phrase);
    }
  });
});

// ============================================================================
// Slice A2 — TTS-down whole-answer mode
// ============================================================================

describe('whole-answer wiring', () => {
  test('TTS preflight routes to whole-answer mode with the recorded prompt', () => {
    const screen = src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx');
    assert.ok(screen.includes('getAvailableVoicesAsync'), 'TTS preflight present');
    assert.ok(screen.includes("'whole'"), 'whole-answer mode exists');
    assert.ok(screen.includes('checkin-fallback-prompt'), 'recorded prompt asset wired');
  });

  test('whole answer caps at two minutes and structures through the backend', () => {
    const screen = src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx');
    assert.ok(screen.includes('WHOLE_ANSWER_SECONDS'), 'cap constant pinned');
    assert.ok(screen.includes('120'), 'two-minute cap');
    assert.ok(screen.includes('structure-checkin'), 'structuring endpoint wired');
  });

  test('mid-interview TTS failure keeps heard answers and flips modes', () => {
    const screen = src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx');
    assert.ok(screen.includes('speakLoud'), 'fallible speak present');
    assert.ok(screen.includes("setMode('whole')"), 'mid-interview flip present');
  });

  test('no clinical or advisory language in whole-answer copy', () => {
    const screen = src('src/screens/VoiceCheckin/VoiceCheckinScreen.tsx').toLowerCase();
    for (const phrase of [
      'diagnos',
      'disorder',
      'syndrome',
      'treatment plan',
      'recommended dose',
      'you should take',
    ]) {
      assert.ok(!screen.includes(phrase), phrase);
    }
  });
});
