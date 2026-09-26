/**
 * medicationCall.test.mts — incoming-call reminder contracts.
 *
 * Pure machine: single-active invariant, per-med confirmation, stale and
 * terminal safety, ±15min presentation grouping. Static guards: route,
 * bridge routing (foreground auto-present, shade actions preserved,
 * cold-start drain), audio/vibration cleanup on every exit, no polling or
 * voice-pipeline deps, taken/snooze reuse the existing engine, ringtone
 * asset present and lightweight.
 */
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  INITIAL_CALL_STATE,
  callMachineReducer,
  groupDueOccurrences,
  isCallTerminal,
  isInstanceLive,
} from '../src/services/medicationCall/callMachine.ts';

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

const reduce = (s: Parameters<typeof callMachineReducer>[0], e: Parameters<typeof callMachineReducer>[1]) =>
  callMachineReducer(s, e);

describe('single active call', () => {
  it('FIRE accepted only from IDLE; duplicates ignored', () => {
    let s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: ['a'] });
    assert.equal(s.phase, 'RINGING');
    assert.equal(s.callId, 'a');
    const before = s;
    s = reduce(s, { type: 'FIRE', callId: 'a', members: ['a'] });
    assert.deepEqual(s, before);
    s = reduce(s, { type: 'FIRE', callId: 'b', members: ['b'] });
    assert.deepEqual(s, before);
  });

  it('empty member lists never fire', () => {
    const s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: [] });
    assert.equal(s.phase, 'IDLE');
  });

  it('late STALE cannot resurrect a finished call, RESET re-arms', () => {
    let s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: ['a'] });
    s = reduce(s, { type: 'ANSWER' });
    s = reduce(s, { type: 'MED_TAKEN', occurrenceId: 'a' });
    s = reduce(s, { type: 'ALL_CONFIRMED' });
    assert.equal(s.phase, 'COMPLETED');
    const before = s;
    s = reduce(s, { type: 'FIRE', callId: 'a', members: ['a'] });
    assert.deepEqual(s, before);
    s = reduce(s, { type: 'RESET' });
    assert.deepEqual(s, INITIAL_CALL_STATE);
  });
});

describe('answer → per-med confirm → taken', () => {
  it('each member confirmed individually; group completes together', () => {
    let s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: ['a', 'b'] });
    s = reduce(s, { type: 'ANSWER' });
    assert.equal(s.phase, 'CONFIRMING');
    s = reduce(s, { type: 'MED_TAKEN', occurrenceId: 'a' });
    assert.equal(s.phase, 'CONFIRMING');
    assert.ok(s.taken['a'] && !s.taken['b']);
    // Unknown occurrence ignored.
    const before = s;
    s = reduce(s, { type: 'MED_TAKEN', occurrenceId: 'zzz' });
    assert.deepEqual(s, before);
    s = reduce(s, { type: 'MED_TAKEN', occurrenceId: 'b' });
    assert.equal(s.phase, 'TAKEN');
    s = reduce(s, { type: 'ALL_CONFIRMED' });
    assert.equal(s.phase, 'COMPLETED');
  });

  it('decline leads to remind-later, never auto-missed', () => {
    let s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: ['a'] });
    s = reduce(s, { type: 'DECLINE' });
    assert.equal(s.phase, 'DECLINED');
    s = reduce(s, { type: 'SNOOZED' });
    assert.equal(s.phase, 'REMIND_LATER');
    assert.ok(!('MISSED' in s));
  });

  it('cancel/interrupt/expire terminate from active phases only', () => {
    for (const e of [{ type: 'CANCEL' }, { type: 'INTERRUPT' }, { type: 'EXPIRE', reason: 'x' }] as const) {
      assert.deepEqual(reduce(INITIAL_CALL_STATE, e), INITIAL_CALL_STATE);
    }
    let s = reduce(INITIAL_CALL_STATE, { type: 'FIRE', callId: 'a', members: ['a'] });
    s = reduce(s, { type: 'INTERRUPT' });
    assert.equal(s.phase, 'INTERRUPTED');
    assert.ok(isCallTerminal('COMPLETED') && isCallTerminal('REMIND_LATER') && !isCallTerminal('RINGING'));
  });
});

describe('stale + grouping (pure)', () => {
  it('only scheduled rows are live', () => {
    assert.ok(isInstanceLive('scheduled'));
    for (const st of ['taken', 'snoozed', 'dismissed', 'fired']) assert.ok(!isInstanceLive(st));
  });

  it('same-time meds group into one call; outsiders excluded', () => {
    const primary = { occurrence_id: 'a', scheduled_at: '2026-09-26T08:00:00', status: 'scheduled' };
    const others = [
      { occurrence_id: 'b', scheduled_at: '2026-09-26T08:10:00', status: 'scheduled' },
      { occurrence_id: 'c', scheduled_at: '2026-09-26T09:30:00', status: 'scheduled' },
      { occurrence_id: 'd', scheduled_at: '2026-09-26T08:05:00', status: 'taken' },
    ];
    assert.deepEqual(groupDueOccurrences(primary, others), ['a', 'b']);
  });
});

test('route + bridge wiring', () => {
  const app = src('App.tsx');
  assert.ok(app.includes('name="MedicationCall"'), 'call route registered');
  assert.ok(app.includes('component={MedicationCallScreen}'), 'call screen mounted');
  assert.ok(
    app.includes("navigation.navigate('MedicationCall', { occurrenceId: parsed.occurrenceId })"),
    'tap/foreground routes to the call UI',
  );
  assert.ok(app.includes('getLastNotificationResponseAsync'), 'cold-start drain present');
  // Shade shortcuts keep existing auto-run behavior (no regression).
  assert.ok(app.includes("navigation.navigate('MedicationReminder'"), 'shade actions preserved');
  const types = src('src/types/index.ts');
  assert.ok(types.includes('MedicationCall: { occurrenceId: string }'), 'route param typed');
});

test('every exit stops audio + vibration (no leaks)', () => {
  const s = src('src/screens/Medications/MedicationCallScreen.tsx');
  assert.ok(s.includes('stopCallVibration()'), 'vibration stop present');
  assert.ok(s.includes('useEffect(() => () => stopCallVibration(), [])'), 'unmount stops vibration');
  assert.ok(s.includes('stopRing(player)'), 'audio teardown present');
  assert.ok(s.includes('startCallVibration()'), 'ringing ambience starts');
  assert.ok(s.includes('RINGTONE_ASSET'), 'bundled chime used');
});

test('taken + snooze reuse the existing engine (no parallel DB)', () => {
  const s = src('src/screens/Medications/MedicationCallScreen.tsx');
  assert.ok(s.includes('takeReminderDose('), 'taken via existing path');
  assert.ok(s.includes('snoozeReminder('), 'snooze via existing chain');
  assert.ok(s.includes('snoozeOptionsFor('), 'existing delay options reused');
  assert.ok(!/\bMISSED\b/.test(s), 'never auto-marks missed');
  assert.ok(!/setInterval|setTimeout\(.*poll|WebSocket|stt|tts|voiceSession/i.test(s), 'no polling/voice/pipeline');
});

test('ringtone asset is original, tiny, and bundled', () => {
  const p = path.join(ROOT, 'assets/audio/med-call-chime.wav');
  const st = fs.statSync(p);
  assert.ok(st.size > 8000 && st.size < 100_000, `chime size sane, got ${st.size}`);
  const head = fs.readFileSync(p).subarray(0, 4).toString('ascii');
  assert.equal(head, 'RIFF', 'valid WAV header');
  const appJson = src('app.json');
  assert.ok(appJson.includes('assets/audio/*'), 'chime bundled in release builds');
});
