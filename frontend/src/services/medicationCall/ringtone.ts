/**
 * ringtone — original two-tone chime + rhythmic vibration for the call UI.
 *
 * Audio runs through expo-audio (useAudioPlayer hook, owned by the call
 * screen so unmount always stops playback). Vibration uses the RN Vibration
 * API already used elsewhere in the app. No telecom behavior, no copyrighted
 * sounds: assets/audio/med-call-chime.wav is a generated 2s chime (32 KB).
 */

import { Platform, Vibration } from 'react-native';

/** Bundled chime (assetBundlePatterns includes assets/audio/*). */
export const RINGTONE_ASSET = require('../../../assets/audio/med-call-chime.wav');

/** Rhythmic incoming-call vibration; `true` repeats until cancelled. */
const RING_PATTERN = [0, 400, 200, 400, 200, 800];

export function startCallVibration(): void {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(RING_PATTERN, true);
  } catch {
    // Vibration is best-effort ambience, never a call blocker.
  }
}

export function stopCallVibration(): void {
  try {
    Vibration.cancel();
  } catch {
    // Best-effort.
  }
}

/** Short confirmation tick on answer / taken. */
export function tapTick(): void {
  if (Platform.OS === 'web') return;
  try {
    Vibration.vibrate(20);
  } catch {
    // Best-effort.
  }
}

export interface RingPlayer {
  play: () => void | Promise<void>;
  pause: () => void | Promise<void>;
  remove?: () => void | Promise<void>;
  loop?: boolean;
}

/** Start the looping chime; safe to call with a half-initialized player. */
export function startRing(player: RingPlayer | null | undefined): void {
  if (!player) return;
  try {
    player.loop = true;
  } catch {
    // Looping unsupported: the single chime still plays once.
  }
  try {
    void player.play();
  } catch {
    // Audio is ambience; a silent call UI is still a correct call UI.
  }
}

/** Stop everything audible immediately (answer/dismiss/unmount/logout). */
export function stopRing(player: RingPlayer | null | undefined): void {
  if (!player) return;
  try {
    void player.pause();
  } catch {
    // Best-effort.
  }
  try {
    void player.remove?.();
  } catch {
    // Best-effort.
  }
}
