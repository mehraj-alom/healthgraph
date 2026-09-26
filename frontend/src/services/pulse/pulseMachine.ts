/**
 * pulseMachine — single-mode pulse measurement orchestrator (pure logic).
 *
 * Exactly one measurement path is ever active. Face rPPG is preferred when
 * genuinely viable; viability is decided from REAL native capture signals
 * (position/acquisition states, live stability, advancing frame counts) —
 * never from a blind timer. Darkness cannot be metered separately in the
 * JS bridge, so the unavailable copy attributes low light as the most
 * common cause (with a retry path) rather than claiming a light measurement
 * the pipeline never made.
 *
 * States:
 *   IDLE → CHECKING → FACE_RUN → FACE_UNAVAILABLE → FINGERTIP_READY →
 *   FINGERTIP_RUN → COMPLETE | ERROR
 * CANCELLED always returns to IDLE. COMPLETE/ERROR require reset (or a new
 * explicit start) so a finished result is never silently discarded.
 *
 * This module is UI-free and fully node-testable. The screen maps hook
 * states onto these phases; the reducer owns mode exclusivity.
 */

export type PulseMode = 'none' | 'face' | 'fingertip';

export type PulsePhase =
  | 'IDLE'
  | 'CHECKING'
  | 'FACE_RUN'
  | 'FACE_UNAVAILABLE'
  | 'FINGERTIP_READY'
  | 'FINGERTIP_RUN'
  | 'COMPLETE'
  | 'ERROR';

export interface PulseMachineState {
  phase: PulsePhase;
  /** The single authoritative active measurement mode. */
  mode: PulseMode;
  /** Human reason for FACE_UNAVAILABLE / ERROR (pipeline-surfaced). */
  reason: string | null;
  /** True once the face probe observed genuine viability. */
  faceViable: boolean;
  /** Completed modality, set on COMPLETE. */
  completedMode: PulseMode;
}

export type PulseMachineEvent =
  | { type: 'BEGIN_CHECK' }
  | { type: 'FACE_VIABLE' }
  | { type: 'FACE_COMPLETE' }
  | { type: 'FACE_FAILED'; reason: string }
  | { type: 'FACE_UNAVAILABLE'; reason: string }
  | { type: 'CHOOSE_FINGERTIP' }
  | { type: 'RETRY_FACE' }
  | { type: 'BEGIN_FINGERTIP' }
  | { type: 'FINGERTIP_COMPLETE' }
  | { type: 'FINGERTIP_FAILED'; reason: string }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export const INITIAL_PULSE_STATE: PulseMachineState = {
  phase: 'IDLE',
  mode: 'none',
  reason: null,
  faceViable: false,
  completedMode: 'none',
};

/**
 * Pure transition. Illegal transitions are ignored (state returned
 * unchanged) so stray async completions can never create contradictory
 * modes — e.g. a late face COMPLETE landing during a fingertip run.
 */
export function pulseMachineReducer(
  state: PulseMachineState,
  event: PulseMachineEvent,
): PulseMachineState {
  switch (event.type) {
    case 'BEGIN_CHECK':
      if (state.phase !== 'IDLE' && state.phase !== 'ERROR') return state;
      return { ...INITIAL_PULSE_STATE, phase: 'CHECKING', mode: 'face' };
    case 'FACE_VIABLE':
      if (state.phase !== 'CHECKING' || state.mode !== 'face') return state;
      return { ...state, phase: 'FACE_RUN', faceViable: true };
    case 'FACE_COMPLETE':
      if (state.mode !== 'face') return state;
      if (state.phase !== 'CHECKING' && state.phase !== 'FACE_RUN') return state;
      return { ...state, phase: 'COMPLETE', mode: 'none', completedMode: 'face' };
    case 'FACE_FAILED':
    case 'FACE_UNAVAILABLE':
      if (state.mode !== 'face') return state;
      if (state.phase !== 'CHECKING' && state.phase !== 'FACE_RUN') return state;
      return { ...state, phase: 'FACE_UNAVAILABLE', mode: 'none', reason: event.reason };
    case 'CHOOSE_FINGERTIP':
      if (state.phase !== 'FACE_UNAVAILABLE') return state;
      return { ...state, phase: 'FINGERTIP_READY', mode: 'none', reason: null };
    case 'RETRY_FACE':
      if (state.phase !== 'FACE_UNAVAILABLE' && state.phase !== 'ERROR') return state;
      return { ...INITIAL_PULSE_STATE, phase: 'CHECKING', mode: 'face' };
    case 'BEGIN_FINGERTIP':
      // Fingertip may only start when NO face run is active: the screen
      // cancels the face hook before dispatching this event.
      if (state.phase !== 'FINGERTIP_READY') return state;
      if (state.mode !== 'none') return state;
      return { ...state, phase: 'FINGERTIP_RUN', mode: 'fingertip' };
    case 'FINGERTIP_COMPLETE':
      if (state.mode !== 'fingertip' || state.phase !== 'FINGERTIP_RUN') return state;
      return { ...state, phase: 'COMPLETE', mode: 'none', completedMode: 'fingertip' };
    case 'FINGERTIP_FAILED':
      if (state.mode !== 'fingertip' || state.phase !== 'FINGERTIP_RUN') return state;
      return { ...state, phase: 'ERROR', mode: 'none', reason: event.reason };
    case 'CANCEL':
      return { ...INITIAL_PULSE_STATE };
    case 'RESET':
      return { ...INITIAL_PULSE_STATE };
    default:
      return state;
  }
}

/** Minimal native-signal snapshot the probe decides on. */
export interface FaceProbeSample {
  /** Hook screen state at sample time. */
  state: string;
  /** 0..1 live stability (null = unknown). */
  stability: number | null;
  /** Qualified frames collected (null = unknown). */
  frames: number | null;
}

export type FaceViability = 'viable' | 'waiting' | 'unavailable';

/** Native states proving the camera has a real, positioned face signal. */
const VIABLE_FACE_STATES = new Set([
  'POSITION_FACE',
  'ACQUIRING',
  'MEASURING',
  'COMPLETING',
  'COMPLETE',
]);

const VIABILITY_STABILITY_FLOOR = 0.4;

/**
 * Decide face viability from observed native signals (pure, tested).
 *
 * viable:      positioned/acquiring/measuring observed, or stability
 *              >= 0.4 on consecutive samples with advancing frames.
 * unavailable: native FAILED, or the deadline passed with no viability.
 * waiting:     otherwise — keep probing.
 *
 * Darkness is NOT separately diagnosed here: the JS bridge carries no
 * brightness meter, so "no positioned face" is reported as a lock failure
 * with low light named as the most common cause (see copy below).
 */
export function decideFaceViability(
  samples: FaceProbeSample[],
  deadlineExceeded: boolean,
  nativeFailed: boolean,
): FaceViability {
  if (nativeFailed) return 'unavailable';
  let strongStreak = 0;
  let lastFrames: number | null = null;
  for (const s of samples) {
    if (VIABLE_FACE_STATES.has(s.state)) return 'viable';
    const strong =
      s.stability !== null &&
      s.stability >= VIABILITY_STABILITY_FLOOR &&
      (lastFrames === null || s.frames === null || s.frames >= lastFrames);
    strongStreak = strong ? strongStreak + 1 : 0;
    if (strongStreak >= 2) return 'viable';
    if (s.frames !== null) lastFrames = s.frames;
  }
  if (deadlineExceeded) return 'unavailable';
  return 'waiting';
}

/** Probe budget from first FIND_FACE signal (ms). Generous: warmup + user. */
export const FACE_PROBE_DEADLINE_MS = 12_000;

/** Honest fallback copy: names low light as the most common cause, never
 *  as a measured fact, and always offers retry + fingertip. */
export const FACE_UNAVAILABLE_TITLE = 'Face signal unavailable';
export const FACE_UNAVAILABLE_BODY =
  'The camera could not lock onto a steady face signal. ' +
  'The most common cause is low light — face a lamp or window, keep your ' +
  'face inside the guide, and hold still. You can retry the face scan or ' +
  'switch to a fingertip measurement.';

export const FINGERTIP_INSTRUCTIONS: readonly string[] = [
  'Place your fingertip completely over the camera and flash — cover them fully, no gaps.',
  'The flash must fire: the sensor cannot read your pulse in the dark.',
  'Hold still with steady, even contact until the dial fills.',
  'Do not press hard or slide your finger during the measurement.',
];
