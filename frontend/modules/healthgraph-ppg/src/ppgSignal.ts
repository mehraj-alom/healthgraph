/**
 * Pure on-device PPG signal pipeline (reference implementation).
 *
 * Mirrors the native Kotlin/Swift pipeline so the algorithm is unit-testable
 * in JS and reviewable without an Android build:
 *
 * PPGbetter acquisition: per-frame green-channel mean -> 1D time series.
 * Filtering: exponential low-pass (smoothing) to suppress high-frequency noise.
 * Peak detection: local maxima above an adaptive threshold with a refractory
 *   period (physiologically bounded 30–220 bpm).
 * HR: 60 / mean(beat-to-beat seconds). HRV: RMSSD + SDNN on artifact-rejected
 *   RR intervals. Quality: amplitude + stability + coverage score in [0,1].
 *
 * Operates on compact numeric arrays only — never on images.
 */

export const PPG_MIN_HR_BPM = 25;
export const PPG_MAX_HR_BPM = 250;
export const MIN_RELIABLE_QUALITY = 0.5;

/**
 * Continuous live-BPM + finger-presence tuning. Mirrors PpgSignalProcessor.kt
 * exactly (same names, same values) so the heuristics are unit-testable in
 * JS and reviewable without an Android build. See the Kotlin comments for
 * the rationale behind each threshold.
 */
export const Y_MEAN_MIN = 15;
export const Y_MEAN_MAX = 245;
export const RED_DOMINANCE_MIN = 10;
export const UNIFORMITY_MAX_STD = 20;
export const FINGER_PRESENT_FRAMES = 5;
export const FINGER_ABSENT_FRAMES = 5;
export const LIVE_WINDOW_SECONDS = 10;
export const LIVE_MIN_SECONDS = 8;
export const STABLE_COUNT = 5;
export const STABLE_MAX_RANGE_BPM = 10;
export const MIN_VALID_SPAN_MS = 30_000;

/** Per-frame statistics for the fingertip-presence vote (8-bit YUV levels). */
export interface FingerFrameStats {
  yMean: number;
  yStd: number;
  uMean: number;
  vMean: number;
}

/**
 * First-pass fingertip presence vote. All three cues must agree; a single
 * brightness threshold is NOT enough (a bright room would false-trigger).
 */
export function isFingerPresent(stats: FingerFrameStats): boolean {
  if (
    !Number.isFinite(stats.yMean) ||
    !Number.isFinite(stats.yStd) ||
    !Number.isFinite(stats.uMean) ||
    !Number.isFinite(stats.vMean)
  ) {
    return false;
  }
  if (stats.yMean < Y_MEAN_MIN || stats.yMean > Y_MEAN_MAX) return false;
  if (stats.vMean - stats.uMean < RED_DOMINANCE_MIN) return false;
  if (stats.yStd > UNIFORMITY_MAX_STD) return false;
  return true;
}

/**
 * Stability vote over recent consecutive live estimates. Requires at least
 * STABLE_COUNT estimates with max-min spread within STABLE_MAX_RANGE_BPM.
 * A wild sequence (119, 83, 61, 108, 57) fails and must never be displayed
 * or saved — it is NOT smoothed into a believable number.
 */
export function isStableHrSeries(estimates: number[]): boolean {
  if (estimates.length < STABLE_COUNT) return false;
  const recent = estimates.slice(-STABLE_COUNT);
  if (recent.some((e) => !Number.isFinite(e))) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of recent) {
    if (e < lo) lo = e;
    if (e > hi) hi = e;
  }
  return hi - lo <= STABLE_MAX_RANGE_BPM;
}

export interface FingerTracker {
  presentStreak: number;
  absentStreak: number;
  fingerEverSeen: boolean;
  fingerLost: boolean;
}

export function initialFingerTracker(): FingerTracker {
  return { presentStreak: 0, absentStreak: 0, fingerEverSeen: false, fingerLost: false };
}

/**
 * Pure presence-transition step mirroring the native analyzer (temporal
 * consistency both ways). Returns the session event to emit, if any:
 * 'ACQUIRING' on (re)acquisition, 'FINGER_REMOVED' on loss, else null.
 */
export function updateFingerTracker(
  tracker: FingerTracker,
  fingerNow: boolean,
): 'ACQUIRING' | 'FINGER_REMOVED' | null {
  if (fingerNow) {
    tracker.presentStreak += 1;
    tracker.absentStreak = 0;
  } else {
    tracker.absentStreak += 1;
    tracker.presentStreak = 0;
  }
  if (!tracker.fingerEverSeen) {
    if (tracker.presentStreak >= FINGER_PRESENT_FRAMES) {
      tracker.fingerEverSeen = true;
      return 'ACQUIRING';
    }
  } else if (!tracker.fingerLost) {
    if (tracker.absentStreak >= FINGER_ABSENT_FRAMES) {
      tracker.fingerLost = true;
      return 'FINGER_REMOVED';
    }
  } else if (tracker.presentStreak >= FINGER_PRESENT_FRAMES) {
    tracker.fingerLost = false;
    return 'ACQUIRING';
  }
  return null;
}

export interface PpgPipelineOutput {
  heartRateBpm: number | null;
  rrIntervalsMs: number[];
  rmssdMs: number | null;
  sdnnMs: number | null;
  signalQuality: number;
}

/** Exponential moving-average low-pass. alpha ~0.25 matches PPGbetter smoothing. */
export function lowPass(signal: number[], alpha = 0.25): number[] {
  if (signal.length === 0) return [];
  const out = new Array<number>(signal.length);
  out[0] = signal[0];
  for (let i = 1; i < signal.length; i++) {
    out[i] = alpha * signal[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

/**
 * Detect pulse peaks as local maxima above an adaptive threshold.
 * `sampleRateHz` is the effective signal sample rate (frames/s).
 */
export function detectPeaks(filtered: number[], sampleRateHz: number): number[] {
  if (filtered.length < 3 || sampleRateHz <= 0) return [];
  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance =
    filtered.reduce((a, b) => a + (b - mean) * (b - mean), 0) / filtered.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 0.35 * std;
  // Refractory period: fastest plausible pulse ~220bpm -> min gap 0.27s.
  const minGapSamples = Math.max(1, Math.floor(sampleRateHz * 0.27));
  const peaks: number[] = [];
  for (let i = 1; i < filtered.length - 1; i++) {
    if (
      filtered[i] > filtered[i - 1] &&
      filtered[i] >= filtered[i + 1] &&
      filtered[i] > threshold
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGapSamples) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Artifact rejection: keep RR intervals within 300–2000ms and ±30% of median. */
export function cleanRR(rrMs: number[]): number[] {
  const plausible = rrMs.filter((x) => x >= 300 && x <= 2000);
  if (plausible.length < 2) return plausible;
  const sorted = [...plausible].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return plausible.filter((x) => Math.abs(x - median) / median <= 0.3);
}

export function rmssd(rrMs: number[]): number | null {
  if (rrMs.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < rrMs.length; i++) sum += (rrMs[i] - rrMs[i - 1]) ** 2;
  return Math.sqrt(sum / (rrMs.length - 1));
}

export function sdnn(rrMs: number[]): number | null {
  if (rrMs.length < 2) return null;
  const m = mean(rrMs);
  return Math.sqrt(rrMs.reduce((a, b) => a + (b - m) * (b - m), 0) / rrMs.length);
}

/**
 * Signal-quality score in [0,1] from amplitude, peak stability, and coverage.
 * Returns 0 when there is insufficient amplitude or too few beats — callers
 * must reject/mark unreliable rather than fabricate a number.
 */
export function signalQuality(
  raw: number[],
  peakCount: number,
  durationSeconds: number,
): number {
  if (raw.length < 8 || durationSeconds <= 0) return 0;
  const m = mean(raw);
  const variance = mean(raw.map((x) => (x - m) ** 2));
  const std = Math.sqrt(variance);
  const cv = m !== 0 ? std / Math.abs(m) : 0;
  // Pulsatile amplitude typically yields CV in ~0.005–0.15; map to 0..1.
  const amplitudeScore = Math.max(0, Math.min(1, (cv - 0.002) / 0.05));
  // Expected ~1 beat/s; coverage = detected vs expected beats.
  const expected = Math.max(1, durationSeconds * 0.9);
  const coverageScore = Math.max(0, Math.min(1, peakCount / expected));
  const stabilityScore = peakCount >= 5 ? 1 : peakCount / 5;
  const q = 0.45 * amplitudeScore + 0.35 * coverageScore + 0.2 * stabilityScore;
  return Math.max(0, Math.min(1, q));
}

export function processPpgSignal(
  samples: number[],
  timestampsMs: number[],
  durationSeconds: number,
  segmentBreaks: number[] = [],
): PpgPipelineOutput {
  if (samples.length !== timestampsMs.length || samples.length < 8) {
    return {
      heartRateBpm: null,
      rrIntervalsMs: [],
      rmssdMs: null,
      sdnnMs: null,
      signalQuality: 0,
    };
  }
  const spanMs = timestampsMs[timestampsMs.length - 1] - timestampsMs[0];
  const sampleRateHz =
    spanMs > 0 ? (samples.length - 1) / (spanMs / 1000) : samples.length / durationSeconds;
  const filtered = lowPass(samples);
  const peaks = detectPeaks(filtered, Math.max(1, sampleRateHz));
  // Segment breaks (finger-removal boundaries as sample indexes): an RR
  // interval spanning a break bridges two separate placements and must not
  // contaminate HR/HRV. Mirrors PpgSignalProcessor.kt.
  const rawRR: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const spansBreak = segmentBreaks.some(
      (b) => b > peaks[i - 1]! && b <= peaks[i]!,
    );
    if (!spansBreak) {
      rawRR.push(timestampsMs[peaks[i]]! - timestampsMs[peaks[i - 1]]!);
    }
  }
  const rr = cleanRR(rawRR);
  let hr: number | null = null;
  if (rr.length >= 2) {
    const candidate = 60000 / mean(rr);
    if (candidate >= PPG_MIN_HR_BPM && candidate <= PPG_MAX_HR_BPM) hr = candidate;
  }
  // HRV only on sufficient, stable data (conservative wellness gate).
  const hrvOk = durationSeconds >= 30 && rr.length >= 5;
  const q = signalQuality(samples, peaks.length, durationSeconds);
  const reliable = q >= MIN_RELIABLE_QUALITY;
  return {
    heartRateBpm: reliable ? hr : null,
    rrIntervalsMs: rr,
    rmssdMs: hrvOk && reliable ? rmssd(rr) : null,
    sdnnMs: hrvOk && reliable ? sdnn(rr) : null,
    signalQuality: q,
  };
}
