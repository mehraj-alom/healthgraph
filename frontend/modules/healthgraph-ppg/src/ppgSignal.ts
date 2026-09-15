/**
 * Pure on-device PPG signal pipeline (reference implementation).
 *
 * Mirrors the native Kotlin/Swift pipeline so the algorithm is unit-testable
 * in JS and reviewable without an Android build:
 *
 * PPGbetter acquisition: per-frame green-channel mean -> 1D time series.
 * Detrending: trailing moving-average baseline removal (kills slow
 *   auto-exposure / finger-pressure drift without touching the pulse).
 * Filtering: exponential low-pass (smoothing) to suppress high-frequency noise.
 * Peak detection: local maxima above an adaptive threshold with a refractory
 *   period (physiologically bounded 30–220 bpm).
 * HR: 60 / median(beat-to-beat seconds). HRV: RMSSD + SDNN on artifact-rejected
 *   RR intervals. Quality: amplitude + stability + coverage score in [0,1],
 *   multiplicatively gated by a drift factor.
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
  /** Detected pulse peaks in the window (diagnostics; quality uses it too). */
  peakCount: number;
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
 * Baseline-drift removal (P0 fix for camera auto-exposure / finger-pressure
 * wander).
 *
 * The raw scalar is a DC brightness level (~100–200 units) carrying a small
 * pulsatile AC ripple. Camera auto-exposure hunting and slow pressure changes
 * move that DC baseline by several units — more than the pulse itself — so a
 * global peak threshold on the raw series misses beats on one slope side and
 * invents them on the other (the observed ~64–68 BPM vs ~74 BPM reference
 * wander, and the wild 100+ spikes from drift-edge false peaks).
 *
 * `detrend` subtracts a trailing moving average over `trendSeconds` (2s:
 * well below the ~0.8s pulse period, well above drift time constants), so the
 * pulse waveform survives while slow drift is removed. The shift is constant
 * across the window, so beat-to-beat intervals are preserved.
 */
export function detrend(signal: number[], sampleRateHz: number, trendSeconds = 2.0): number[] {
  if (signal.length === 0) return [];
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) return [...signal];
  const window = Math.max(3, Math.min(signal.length, Math.round(sampleRateHz * trendSeconds)));
  const out = new Array<number>(signal.length);
  // Pad the trailing average with the first sample so the first `window`
  // samples have no startup ramp (otherwise the ramp itself injects a false
  // slope — and false edge peaks — into every window).
  const s0 = signal[0]!;
  let run = s0 * window;
  for (let i = 0; i < signal.length; i++) {
    run += signal[i]! - (i < window ? s0 : signal[i - window]!);
    out[i] = signal[i]! - run / window;
  }
  return out;
}

/** Upper-median (matches cleanRR's median convention). */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Sub-sample peak refinement (P1 fix for integer-sample quantization).
 *
 * At 30 fps one sample is 33ms — ~4% of an 800ms beat. Integer peak indexes
 * quantize every RR interval to a 33ms grid, biasing HR by up to ~2 BPM
 * (true 74 -> 75, true 80 -> 78.3) even on noiseless data. Parabolic
 * interpolation through the peak and its neighbors recovers the fractional
 * peak position; RR intervals are then measured between fractional positions
 * on the real timestamp track. Pure arithmetic on the filtered series —
 * no new data, no smoothing of estimates.
 */
export function refinePeak(filtered: number[], i: number): number {
  if (i <= 0 || i >= filtered.length - 1) return i;
  const y0 = filtered[i - 1]!;
  const y1 = filtered[i]!;
  const y2 = filtered[i + 1]!;
  const denom = y0 - 2 * y1 + y2;
  if (!(denom < 0)) return i; // not a concave peak: no refinement
  const offset = (y0 - y2) / (2 * denom);
  if (!Number.isFinite(offset)) return i;
  return i + Math.max(-0.5, Math.min(0.5, offset));
}

/** Timestamp (ms) at a fractional sample position via local interpolation. */
export function sampleTimeAt(timestampsMs: number[], pos: number): number {
  const lo = Math.floor(pos);
  const hi = Math.min(timestampsMs.length - 1, lo + 1);
  const clampedLo = Math.max(0, Math.min(timestampsMs.length - 1, lo));
  const frac = Math.max(0, Math.min(1, pos - clampedLo));
  const a = timestampsMs[clampedLo]!;
  const b = timestampsMs[hi]!;
  return a + frac * (b - a);
}

/**
 * Detect pulse peaks as local maxima above an adaptive threshold.
 * `sampleRateHz` is the effective signal sample rate (frames/s).
 *
 * Threshold is mean + 0.5σ on the DETRENDED series (callers must detrend
 * first): 0.35σ admitted noise-ripple false peaks on real camera data, which
 * produced intermittent short RR intervals (wild 100+ BPM spikes). The
 * refractory gap is 0.30s (200 BPM ceiling): it rejects dicrotic-notch double
 * counts (~0.2–0.3s after systole) while the 25–250 BPM plausibility gate
 * stays unchanged downstream.
 */
export function detectPeaks(filtered: number[], sampleRateHz: number): number[] {
  if (filtered.length < 3 || sampleRateHz <= 0) return [];
  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance =
    filtered.reduce((a, b) => a + (b - mean) * (b - mean), 0) / filtered.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 0.5 * std;
  // Refractory period: dicrotic-notch safe gap 0.30s (-> 200bpm ceiling).
  const minGapSamples = Math.max(1, Math.floor(sampleRateHz * 0.3));
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
 * Quality components in [0,1]. Amplitude is measured on the DETRENDED series
 * (pulsatile AC ripple relative to the raw DC mean): the old raw-CV rewarded
 * slow baseline drift as if it were pulse strength, so drift-dominated garbage
 * could pass the 0.5 gate. `driftFactor` only discounts quality for wander
 * the detrending already removed (floor 0.3); fast jumps still surface via
 * RR validation. Non-finite samples are dropped fail-closed. A flat line
 * still scores exactly 0 (amplitude 0 -> base 0), never a fabricated number.
 */
export interface PpgQualityComponents {
  amplitude: number;
  coverage: number;
  stability: number;
  driftFactor: number;
  /** Std of the detrended (AC) series in raw units. */
  pulseAmplitude: number;
  /** Std of the slow baseline trend relative to the raw mean. */
  driftCv: number;
}

export function qualityComponents(
  raw: number[],
  peakCount: number,
  durationSeconds: number,
  sampleRateHz: number,
): PpgQualityComponents {
  const zero = {
    amplitude: 0,
    coverage: 0,
    stability: 0,
    driftFactor: 0,
    pulseAmplitude: 0,
    driftCv: 0,
  };
  if (raw.length < 8 || durationSeconds <= 0) return zero;
  // Fail closed: one NaN/Infinity must never poison quality into NaN (which
  // would neither pass nor clearly fail downstream gates).
  const finite = raw.filter((x) => Number.isFinite(x));
  if (finite.length < 8) return zero;
  const m = mean(finite);
  const detrended = detrend(finite, sampleRateHz);
  const acStd = Math.sqrt(mean(detrended.map((x) => x * x)));
  const cv = m !== 0 ? acStd / Math.abs(m) : 0;
  // Pulsatile amplitude typically yields AC CV in ~0.005–0.15; map to 0..1.
  const amplitude = Math.max(0, Math.min(1, (cv - 0.002) / 0.05));
  // Expected ~1 beat/s; coverage = detected vs expected beats.
  const expected = Math.max(1, durationSeconds * 0.9);
  const coverage = Math.max(0, Math.min(1, peakCount / expected));
  const stability = peakCount >= 5 ? 1 : peakCount / 5;
  // Baseline trend = raw minus detrended; its relative energy is drift.
  const detrendedMean = mean(detrended);
  const trendMean = m - detrendedMean;
  const driftStd = Math.sqrt(
    mean(
      finite.map((x, i) => {
        const trend = x - detrended[i]!;
        return (trend - trendMean) ** 2;
      }),
    ),
  );
  const driftCv = m !== 0 ? driftStd / Math.abs(m) : 0;
  // Drift slower than the 2s detrend window is already removed before peak
  // detection, so it only DISCOUNTS quality (fast jumps still surface via RR
  // validation). A 0.3 floor keeps the 0.5 gate meaningful without vetoing a
  // cleanly detected pulse over a wandering baseline.
  const driftFactor = Math.max(0.3, Math.min(1, 1 - driftCv / 0.15));
  return { amplitude, coverage, stability, driftFactor, pulseAmplitude: acStd, driftCv };
}

/**
 * Signal-quality score in [0,1] from amplitude, peak stability, coverage,
 * and baseline-drift correction.
 * Returns 0 when there is insufficient amplitude or too few beats — callers
 * must reject/mark unreliable rather than fabricate a number.
 */
export function signalQuality(
  raw: number[],
  peakCount: number,
  durationSeconds: number,
): number {
  if (raw.length < 8 || durationSeconds <= 0) return 0;
  const fs = raw.length / Math.max(1, durationSeconds);
  const c = qualityComponents(raw, peakCount, durationSeconds, Math.max(1, fs));
  const base = 0.45 * c.amplitude + 0.35 * c.coverage + 0.2 * c.stability;
  return Math.max(0, Math.min(1, base * c.driftFactor));
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
      peakCount: 0,
    };
  }
  const spanMs = timestampsMs[timestampsMs.length - 1] - timestampsMs[0];
  const sampleRateHz =
    spanMs > 0 ? (samples.length - 1) / (spanMs / 1000) : samples.length / durationSeconds;
  // Detrend BEFORE smoothing: slow baseline drift (auto-exposure, pressure)
  // must not reach the global peak threshold. Then low-pass the residual.
  const detrended = detrend(samples, Math.max(1, sampleRateHz));
  const filtered = lowPass(detrended);
  const peaks = detectPeaks(filtered, Math.max(1, sampleRateHz));
  // Segment breaks (finger-removal boundaries as sample indexes): an RR
  // interval spanning a break bridges two separate placements and must not
  // contaminate HR/HRV. Mirrors PpgSignalProcessor.kt.
  // RR intervals are measured between SUB-SAMPLE peak positions (parabolic
  // refinement) on the real timestamp track — integer indexes would quantize
  // every beat to the 33ms frame grid (±2 BPM bias at 30fps).
  const rawRR: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const spansBreak = segmentBreaks.some(
      (b) => b > peaks[i - 1]! && b <= peaks[i]!,
    );
    if (!spansBreak) {
      const tPrev = sampleTimeAt(timestampsMs, refinePeak(filtered, peaks[i - 1]!));
      const tCurr = sampleTimeAt(timestampsMs, refinePeak(filtered, peaks[i]!));
      rawRR.push(tCurr - tPrev);
    }
  }
  const rr = cleanRR(rawRR);
  let hr: number | null = null;
  if (rr.length >= 2) {
    // Median, not mean: one mistimed peak (noise double-count or a drift-edge
    // miss) shifts the mean by ~15% (74 -> ~64 BPM) but barely moves the
    // median. This is the direct fix for the observed reference discrepancy.
    const candidate = 60000 / median(rr);
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
    peakCount: peaks.length,
  };
}

/**
 * One rolling-window HR estimate through the standard pipeline (same quality
 * gate). Returns null when the window is too short or unreliable — callers
 * display nothing rather than a stale number. Mirrors
 * PpgSignalProcessor.liveHrFromWindow.
 */
export function liveHrFromWindow(
  samples: number[],
  timestampsMs: number[],
  windowSeconds = LIVE_WINDOW_SECONDS,
): number | null {
  if (samples.length !== timestampsMs.length || samples.length < 8) return null;
  const endMs = timestampsMs[timestampsMs.length - 1]!;
  const cutMs = endMs - windowSeconds * 1000;
  let from = 0;
  while (from < timestampsMs.length && timestampsMs[from]! < cutMs) from++;
  const wSamples = samples.slice(from);
  const wTs = timestampsMs.slice(from);
  if (wSamples.length < 8) return null;
  if (wTs[wTs.length - 1]! - wTs[0]! < LIVE_MIN_SECONDS * 1000) return null;
  return processPpgSignal(wSamples, wTs, windowSeconds).heartRateBpm;
}

/**
 * Displayed live BPM from recent raw estimates: median of the last up to 3.
 * All inputs are real pipeline estimates — this hides single-tick display
 * jitter (72, 74, 72) without converting an invalid sequence (119, 83, 61)
 * into a believable number. Callers must still gate on isStableHrSeries over
 * the RAW history; this function performs no stability judgment.
 */
export function displayHrFromRecent(recentRaw: number[]): number | null {
  if (recentRaw.length === 0) return null;
  return median(recentRaw.slice(-3));
}

/** DEBUG-only diagnostic snapshot (Part 3 telemetry). No images, no waveforms. */
export interface PpgDiagnostics {
  sampleCount: number;
  windowSeconds: number;
  signalMean: number;
  signalStd: number;
  pulseAmplitude: number;
  driftCv: number;
  amplitudeScore: number;
  coverageScore: number;
  stabilityScore: number;
  driftFactor: number;
  quality: number;
  peakCount: number;
  beatCount: number;
  rrMedianMs: number | null;
  rrSpreadMs: number | null;
}

export function diagnosePpg(
  raw: number[],
  durationSeconds: number,
  sampleRateHz: number,
  peakCount: number,
  rrIntervalsMs: number[],
): PpgDiagnostics {
  const c = qualityComponents(raw, peakCount, durationSeconds, Math.max(1, sampleRateHz));
  const base = 0.45 * c.amplitude + 0.35 * c.coverage + 0.2 * c.stability;
  const m = raw.length > 0 ? mean(raw) : NaN;
  const std =
    raw.length > 0 ? Math.sqrt(mean(raw.map((x) => (x - m) ** 2))) : NaN;
  const sorted = [...rrIntervalsMs].sort((a, b) => a - b);
  return {
    sampleCount: raw.length,
    windowSeconds: durationSeconds,
    signalMean: m,
    signalStd: std,
    pulseAmplitude: c.pulseAmplitude,
    driftCv: c.driftCv,
    amplitudeScore: c.amplitude,
    coverageScore: c.coverage,
    stabilityScore: c.stability,
    driftFactor: c.driftFactor,
    quality: Math.max(0, Math.min(1, base * c.driftFactor)),
    peakCount,
    beatCount: rrIntervalsMs.length,
    rrMedianMs: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : null,
    rrSpreadMs: sorted.length > 1 ? sorted[sorted.length - 1]! - sorted[0]! : null,
  };
}

export interface PpgDebugSummaryInput {
  fingerPresencePct: number | null;
  framesReceived: number;
  samplesAccepted: number;
  framesRejected: number;
  effectiveFps: number | null;
  diagnostics: PpgDiagnostics;
  rawHrEstimates: number[];
  displayedHr: number | null;
  finalHr: number | null;
  failureReason: string | null;
  stable: boolean;
}

/**
 * DEBUG-only end-of-measurement summary (Part 16). Lets a hardware run answer
 * "was the optical signal or the estimator wrong?" without persisting or
 * logging any frame, image, or waveform data.
 */
export function buildDebugSummary(input: PpgDebugSummaryInput): string {
  const d = input.diagnostics;
  const fmt = (v: number | null, digits = 1) =>
    v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(digits);
  const lines = [
    'PPG DEBUG SUMMARY',
    `Finger presence: ${input.fingerPresencePct == null ? 'n/a' : `${input.fingerPresencePct.toFixed(0)}%`}`,
    `Frames: ${input.framesReceived} Accepted: ${input.samplesAccepted} Rejected: ${input.framesRejected}`,
    `FPS: ${fmt(input.effectiveFps)}`,
    `Window: ${fmt(d.windowSeconds)}s (n=${d.sampleCount})`,
    `Signal mean: ${fmt(d.signalMean)} std: ${fmt(d.signalStd, 2)}`,
    `Pulse amplitude: ${fmt(d.pulseAmplitude, 3)} Drift CV: ${fmt(d.driftCv, 4)}`,
    `Quality: amp=${fmt(d.amplitudeScore, 2)} cov=${fmt(d.coverageScore, 2)} stab=${fmt(d.stabilityScore, 2)} drift=${fmt(d.driftFactor, 2)} final=${fmt(d.quality, 2)}`,
    `Peaks: ${d.peakCount} Beats: ${d.beatCount}`,
    `RR median: ${fmt(d.rrMedianMs, 0)}ms spread: ${fmt(d.rrSpreadMs, 0)}ms`,
    `Raw HR estimates: ${input.rawHrEstimates.length > 0 ? input.rawHrEstimates.map((e) => e.toFixed(0)).join(', ') : 'none'}`,
    `Displayed HR: ${input.displayedHr == null ? 'none' : input.displayedHr.toFixed(0)}`,
    `Final HR: ${input.finalHr == null ? `REJECTED${input.failureReason ? ` (${input.failureReason})` : ''}` : input.finalHr.toFixed(0)}`,
    `Stability: ${input.stable ? 'PASS' : 'FAIL'}`,
  ];
  return lines.join('\n');
}
