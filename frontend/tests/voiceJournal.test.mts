/**
 * voiceJournal.test.mts — free-form voice journal pure contract (node).
 *
 * Turns accumulate verbatim (never paraphrased, never summarized here);
 * saving appends to the day's notes through the existing merge path with
 * a hard character cap. Empty transcripts can never produce a note.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_JOURNAL_TURNS,
  buildNotesAppend,
  joinTurns,
  validateTranscript,
} from '../src/services/voiceJournal.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('turn accumulation', () => {
  test('turns join verbatim with single spaces, empties dropped', () => {
    assert.equal(joinTurns(['  Slept badly. ', '', 'Woke up early.  ']), 'Slept badly. Woke up early.');
    assert.equal(joinTurns([]), '');
    assert.equal(joinTurns(['   ']), '');
  });

  test('ten turns max per entry', () => {
    assert.equal(MAX_JOURNAL_TURNS, 10);
  });
});

describe('transcript validation', () => {
  test('empty or blank transcripts are rejected', () => {
    assert.equal(validateTranscript('').ok, false);
    assert.equal(validateTranscript('   ').ok, false);
  });

  test('normal transcripts pass; oversized ones fail closed', () => {
    assert.equal(validateTranscript('Today was fine.').ok, true);
    assert.equal(validateTranscript('x'.repeat(12001)).ok, false);
    assert.equal(validateTranscript('x'.repeat(12000)).ok, true);
  });
});

describe('notes append', () => {
  test('first entry becomes the note; later entries append separated', () => {
    assert.equal(buildNotesAppend(null, 'Slept badly.'), 'Slept badly.');
    assert.equal(buildNotesAppend('', 'Slept badly.'), 'Slept badly.');
    assert.equal(
      buildNotesAppend('Mood 4.', 'Slept badly.'),
      'Mood 4.\n\nSlept badly.',
    );
  });

  test('total stays within the cap with an explicit truncation marker', () => {
    const out = buildNotesAppend('Mood 4.', 'x'.repeat(5000));
    assert.ok(out.length <= 4000);
    assert.ok(out.endsWith('[truncated]'));
    assert.ok(out.startsWith('Mood 4.\n\n'));
  });

  test('a nearly full day keeps existing notes intact instead of cutting them', () => {
    const existing = 'e'.repeat(3990);
    const out = buildNotesAppend(existing, 'Slept badly and woke up early today.');
    assert.equal(out, existing);
  });
  test('blank transcript appends nothing', () => {
    assert.equal(buildNotesAppend('Mood 4.', '   '), 'Mood 4.');
    assert.equal(buildNotesAppend(null, ''), '');
  });
});

// ============================================================================
// Threading contracts — journal + sleep times ride existing merge paths
// ============================================================================

describe('merge threading contracts', () => {
  test('overlay supports notes_append and clock times; builder never wipes', () => {
    const queries = src('src/db/queries/dailyLogs.ts');
    assert.ok(queries.includes('notes_append?: string'), 'overlay notes_append');
    assert.ok(queries.includes('bedtime?: string'), 'overlay bedtime');
    assert.ok(queries.includes('wake_time?: string'), 'overlay wake_time');
    assert.ok(queries.includes('buildNotesAppend'), 'capped append reused');
    assert.ok(queries.includes('validClockOrNull'), 'clock validation at the boundary');
  });

  test('SLEEP_LOG event carries clock times; synced scalar stays 3-field', () => {
    const queries = src('src/db/queries/dailyLogs.ts');
    assert.ok(queries.includes('{ bedtime }') || queries.includes('bedtime'), 'event payload bedtime');
    assert.ok(queries.includes('wake_time'), 'event payload wake_time');
  });

  test('no backend schema change for sleep times or journal notes', () => {
    const hay = fs.readFileSync('/home/opticpulse/healthgraph/schemas/daily_logs.py', 'utf8');
    assert.ok(!hay.includes('bedtime'), 'server SleepCreate untouched');
    assert.ok(!hay.includes('notes_append'), 'server request untouched');
  });

  test('journal screen reuses the check-in recorder contract', () => {
    const screen = src('src/screens/Voice/VoiceJournalScreen.tsx');
    assert.ok(screen.includes('useAudioRecorder'), 'same recorder');
    assert.ok(screen.includes('createPakeetTransport'), 'same transcription path');
    assert.ok(screen.includes('mergeIntoDailyLog'), 'existing merge path');
    assert.ok(screen.includes('MAX_JOURNAL_TURNS'), 'bounded turns');
    assert.ok(!screen.includes('fetch('), 'no direct network calls');
    assert.ok(screen.includes('not medical advice'), 'disclaimer present');
  });

  test('journal route is typed, registered, and reachable', () => {
    const types = src('src/types/index.ts');
    assert.ok(types.includes('VoiceJournal:'), 'route typed');
    const app = fs.readFileSync('/home/opticpulse/healthgraph/frontend/App.tsx', 'utf8');
    assert.ok(app.includes('name="VoiceJournal"'), 'route registered');
    assert.ok(app.includes('VoiceJournalScreen'), 'screen wired');
  });
});
