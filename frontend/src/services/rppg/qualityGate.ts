/**
 * rPPG quality gating — pure TypeScript, rPPG-specific thresholds.
 *
 * Finger-tip PPG thresholds are NOT reused: face capture has its own
 * failure modes (face motion, frame drops, fps drift, weak pulsatility).
 * Inputs combine capture telemetry, waveform statistics, and the spectral
 * estimate. Output is a clear level:
 *
 * - reliable:     safe to persist as a real measurement
 * - borderline:   persist with reliable=0 (visible, flagged, synced)
 * - insufficient: HR must be discarded — never saved, never synced
 */

import type { RppgHrEstimate } from './hrEstimator';

export type RppgQualityLevel = 'reliable' | 'borderline' | 'insufficient';

export interface RppgQualityInput {
  /** Fraction of window frames with a stable positioned face (0..1). */
  faceStableFrac: number;
  /** Fraction of capture frames dropped (0..1). */
  droppedFrac: number;
  /** Effective capture rate (Hz). */
  fpsMeasured: number;
  /** Variance of the raw 160-sample waveform. */
  waveformVariance: number;
  /** Spectral HR estimate with concentration + segment spread. */
  hr: RppgHrEstimate;
}

export interface RppgQualityResult {
  level: RppgQualityLevel;
  /** 0..1 composite score (display + persistence detail). */
  score: number;
  /** Human-safe reason tokens for logs/UI (no biometric content). */
  reasons: string[];
}

/** rPPG-specific gates (NOT fingertip PPG thresholds). */
export const RPPG_Q = {
  stableReliable: 0.75,
  stableBorderline: 0.5,
  droppedMax: 0.25,
  fpsTolerance: 0.08,
  concentrationReliable: 0.3,
  concentrationBorderline: 0.18,
  scoreReliable: 0.6,
  scoreBorderline: 0.4,
  varianceFloor: 1e-9,
} as const;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Persistence reliability flag: an actual heart rate, adequate composite
 * quality, and a complete capture window (≈5 s at 30 fps — NOT the 30 s
 * fingertip threshold). Shared by the SQLite repository.
 */
export function rppgReliableForPersistence(
  heartRateBpm: number | null,
  signalQuality: number,
  durationSeconds: number,
): boolean {
  return (
    heartRateBpm != null && signalQuality >= 0.5 && durationSeconds >= 5
  );
}

export function gateRppgQuality(input: RppgQualityInput): RppgQualityResult {
  const reasons: string[] = [];
  const fpsDev = Math.abs(input.fpsMeasured - 30) / 30;
  const stability = clamp01(input.faceStableFrac);
  const continuity = clamp01(1 - input.droppedFrac * 2);
  const fpsScore = clamp01(1 - fpsDev / RPPG_Q.fpsTolerance);
  const concentration = clamp01(input.hr.concentration * 2);
  const agreement = clamp01(1 - input.hr.segmentSpreadBpm / 10);
  const score =
    0.3 * stability +
    0.2 * continuity +
    0.15 * fpsScore +
    0.25 * concentration +
    0.1 * agreement;

  let level: RppgQualityLevel = 'insufficient';
  if (input.hr.bpm === null) {
    reasons.push(`no-hr:${input.hr.reason ?? 'unknown'}`);
  }
  if (!(input.waveformVariance > RPPG_Q.varianceFloor)) {
    reasons.push('flat-waveform');
  }
  if (input.droppedFrac > RPPG_Q.droppedMax) {
    reasons.push('frame-loss');
  }
  if (fpsDev > RPPG_Q.fpsTolerance) {
    reasons.push('fps-drift');
  }
  if (input.faceStableFrac < RPPG_Q.stableBorderline) {
    reasons.push('unstable-face');
  }
  if (input.hr.concentration < RPPG_Q.concentrationBorderline) {
    reasons.push('weak-spectrum');
  }

  if (
    input.hr.bpm !== null &&
    input.waveformVariance > RPPG_Q.varianceFloor &&
    score >= RPPG_Q.scoreReliable &&
    input.hr.concentration >= RPPG_Q.concentrationReliable &&
    input.faceStableFrac >= RPPG_Q.stableReliable &&
    fpsDev <= RPPG_Q.fpsTolerance &&
    input.droppedFrac <= RPPG_Q.droppedMax
  ) {
    level = 'reliable';
  } else if (
    input.hr.bpm !== null &&
    input.waveformVariance > RPPG_Q.varianceFloor &&
    score >= RPPG_Q.scoreBorderline &&
    input.hr.concentration >= RPPG_Q.concentrationBorderline &&
    input.faceStableFrac >= RPPG_Q.stableBorderline
  ) {
    level = 'borderline';
    reasons.push('borderline');
  } else if (reasons.length === 0) {
    reasons.push('low-score');
  }
  return { level, score, reasons };
}
