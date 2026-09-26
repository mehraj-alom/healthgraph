/**
 * pulseOrchestrator.test.mts — single-mode invariant + viability decisions.
 *
 * Proves, from the pure machine (no UI, no camera):
 * - exactly one measurement mode is ever active;
 * - face viability comes from real native signals, never a bare timer;
 * - fallback, retry, cancel, and late-completion races are safe.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACE_UNAVAILABLE_BODY,
  FINGERTIP_INSTRUCTIONS,
  INITIAL_PULSE_STATE,
  decideFaceViability,
  pulseMachineReducer,
  type PulseMachineState,
} from '../src/services/pulse/pulseMachine.ts';

const reduce = (s: PulseMachineState, e: Parameters<typeof pulseMachineReducer>[1]) =>
  pulseMachineReducer(s, e);

describe('single active mode', () => {
  it('face check owns the mode until it settles', () => {
    let s = reduce(INITIAL_PULSE_STATE, { type: 'BEGIN_CHECK' });
    assert.equal(s.phase, 'CHECKING');
    assert.equal(s.mode, 'face');
    s = reduce(s, { type: 'FACE_VIABLE' });
    assert.equal(s.phase, 'FACE_RUN');
    assert.equal(s.mode, 'face');
  });

  it('fingertip cannot start while a face run is active', () => {
    let s = reduce(INITIAL_PULSE_STATE, { type: 'BEGIN_CHECK' });
    s = reduce(s, { type: 'FACE_VIABLE' });
    const before = s;
    s = reduce(s, { type: 'BEGIN_FINGERTIP' });
    assert.deepEqual(s, before);
    assert.equal(s.mode, 'face');
  });

  it('late face completion during fingertip is ignored', () => {
    let s = reduce(INITIAL_PULSE_STATE, { type: 'BEGIN_CHECK' });
    s = reduce(s, { type: 'FACE_UNAVAILABLE', reason: 'x' });
    s = reduce(s, { type: 'CHOOSE_FINGERTIP' });
    s = reduce(s, { type: 'BEGIN_FINGERTIP' });
    const before = s;
    s = reduce(s, { type: 'FACE_COMPLETE' });
    assert.deepEqual(s, before);
    assert.equal(s.mode, 'fingertip');
  });

  it('cancel always returns to a clean idle with no mode', () => {
    let s = reduce(INITIAL_PULSE_STATE, { type: 'BEGIN_CHECK' });
    s = reduce(s, { type: 'CANCEL' });
    assert.deepEqual(s, INITIAL_PULSE_STATE);
  });

  it('completed results require an explicit new start', () => {
    let s = reduce(INITIAL_PULSE_STATE, { type: 'BEGIN_CHECK' });
    s = reduce(s, { type: 'FACE_VIABLE' });
    s = reduce(s, { type: 'FACE_COMPLETE' });
    assert.equal(s.phase, 'COMPLETE');
    assert.equal(s.mode, 'none');
    assert.equal(s.completedMode, 'face');
    // No silent restart from COMPLETE.
    const before = s;
    s = reduce(s, { type: 'BEGIN_CHECK' });
    assert.deepEqual(s, before);
  });
});

describe('face viability from real signals', () => {
  it('positioned/acquiring native states are viable immediately', () => {
    assert.equal(
      decideFaceViability([{ state: 'POSITION_FACE', stability: 0.5, frames: 20 }], false, false),
      'viable',
    );
    assert.equal(
      decideFaceViability([{ state: 'FIND_FACE', stability: null, frames: 0 }], false, false),
      'waiting',
    );
  });

  it('sustained strong stability with advancing frames is viable', () => {
    const samples = [
      { state: 'FIND_FACE', stability: 0.45, frames: 10 },
      { state: 'FIND_FACE', stability: 0.52, frames: 14 },
    ];
    assert.equal(decideFaceViability(samples, false, false), 'viable');
  });

  it('a bare timer with no signal never reports viable', () => {
    const samples = Array.from({ length: 40 }, (_, i) => ({
      state: 'FIND_FACE',
      stability: 0.1,
      frames: i,
    }));
    // Deadline not exceeded → still waiting, never viable on time alone.
    assert.equal(decideFaceViability(samples, false, false), 'waiting');
    // Deadline exceeded with no signal → unavailable, never viable.
    assert.equal(decideFaceViability(samples, true, false), 'unavailable');
  });

  it('native failure is unavailable immediately', () => {
    assert.equal(decideFaceViability([], false, true), 'unavailable');
  });

  it('weak single blips do not count (streak of 2 required)', () => {
    const samples = [
      { state: 'FIND_FACE', stability: 0.9, frames: 10 },
      { state: 'FIND_FACE', stability: 0.1, frames: 12 },
    ];
    assert.equal(decideFaceViability(samples, false, false), 'waiting');
  });
});

describe('honest fallback copy', () => {
  it('unavailable copy names low light as common cause, never measured fact', () => {
    assert.match(FACE_UNAVAILABLE_BODY, /most common cause is low light/);
    assert.doesNotMatch(FACE_UNAVAILABLE_BODY, /measured|detected darkness|light sensor/i);
  });

  it('fingertip instructions match the native protocol (cover + flash + still)', () => {
    const text = FINGERTIP_INSTRUCTIONS.join(' ');
    assert.match(text, /camera and flash/i);
    assert.match(text, /cover them fully/i);
    assert.match(text, /flash must fire/i);
    assert.match(text, /hold still/i);
  });
});
