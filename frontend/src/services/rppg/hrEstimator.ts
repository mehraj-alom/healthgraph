/**
 * rPPG heart-rate estimation — frequency-domain, pure TypeScript.
 *
 * The ONNX provider returns only the raw 160-sample waveform; BPM is
 * estimated HERE, never in the provider. Method: linear detrend, Hann
 * window, zero-padded (256) radix-2 FFT, spectral peak search in the
 * 25–250 bpm band with parabolic interpolation, spectral-concentration
 * scoring, and sub-window agreement. Hard-invalid waveforms are refused
 * (null + reason); borderline cases carry metrics for the quality gate.
 *
 * No dependencies. Deterministic. Fully unit-testable with synthetic waves.
 */

export const RPPG_HR_MIN_BPM = 25;
export const RPPG_HR_MAX_BPM = 250;
/** Sub-window disagreement above this refuses the estimate (bpm). */
export const RPPG_HR_SEGMENT_AGREE_MAX_BPM = 10;
/** Flat-line variance floor: below this there is no pulsatile signal. */
const FLAT_VARIANCE_FLOOR = 1e-9;

export type RppgHrRejectReason =
  | 'EMPTY'
  | 'NON_FINITE'
  | 'FLAT'
  | 'EDGE_PEAK'
  | 'UNSTABLE_SEGMENTS';

export interface RppgHrEstimate {
  /** Beats per minute, or null when the waveform cannot support one. */
  readonly bpm: number | null;
  /** 0..1 spectral concentration around the peak (higher = cleaner). */
  readonly concentration: number;
  /** Max pairwise disagreement between full/half-window estimates (bpm). */
  readonly segmentSpreadBpm: number;
  /** Peak frequency (Hz), present even when rejected for edge/unsteady. */
  readonly peakHz: number | null;
  readonly reason: RppgHrRejectReason | null;
}

/** In-place radix-2 FFT on interleaved [re,im] Float64Array. Length must be 2^k. */
function fftInterleaved(data: Float64Array): void {
  const n = data.length >>> 1;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >>> 1;
    for (; j & bit; bit >>>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const i2 = i << 1;
      const j2 = j << 1;
      const tr = data[i2];
      data[i2] = data[j2];
      data[j2] = tr;
      const ti = data[i2 + 1];
      data[i2 + 1] = data[j2 + 1];
      data[j2 + 1] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const u2 = (i + k) << 1;
        const v2 = (i + k + len / 2) << 1;
        const vr = data[v2] * cwr - data[v2 + 1] * cwi;
        const vi = data[v2] * cwi + data[v2 + 1] * cwr;
        data[v2] = data[u2] - vr;
        data[v2 + 1] = data[u2 + 1] - vi;
        data[u2] += vr;
        data[u2 + 1] += vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

function linearDetrend(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += x[i];
    sxx += i * i;
    sxy += i * x[i];
  }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const intercept = (sy - slope * sx) / n;
  for (let i = 0; i < n; i++) out[i] = x[i] - (slope * i + intercept);
  return out;
}

interface SpectrumPeak {
  bpm: number;
  peakHz: number;
  concentration: number;
  edge: boolean;
}

function spectrumPeak(
  wave: ArrayLike<number>,
  fps: number,
  fftSize = 256,
): SpectrumPeak | null {
  const n = wave.length;
  if (n < 16 || !(fps > 0) || !Number.isFinite(fps)) return null;
  const detrended = linearDetrend(Float64Array.from(wave as ArrayLike<number>));
  const buf = new Float64Array(fftSize * 2);
  for (let i = 0; i < n; i++) {
    // Hann window suppresses leakage from the short 160-sample record.
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    buf[i * 2] = detrended[i] * w;
  }
  fftInterleaved(buf);
  const mag2 = new Float64Array(fftSize / 2);
  for (let k = 0; k < fftSize / 2; k++) {
    mag2[k] = buf[k * 2] * buf[k * 2] + buf[k * 2 + 1] * buf[k * 2 + 1];
  }
  const loHz = RPPG_HR_MIN_BPM / 60;
  const hiHz = RPPG_HR_MAX_BPM / 60;
  const kLo = Math.max(1, Math.floor((loHz * fftSize) / fps));
  const kHi = Math.min(fftSize / 2 - 2, Math.ceil((hiHz * fftSize) / fps));
  if (kHi <= kLo) return null;
  let best = kLo;
  for (let k = kLo + 1; k <= kHi; k++) {
    if (mag2[k] > mag2[best]) best = k;
  }
  let bandPower = 0;
  for (let k = kLo; k <= kHi; k++) bandPower += mag2[k];
  if (!(bandPower > 0)) return null;
  // Parabolic interpolation for sub-bin resolution.
  const y0 = mag2[best - 1];
  const y1 = mag2[best];
  const y2 = mag2[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const offset = denom !== 0 ? ((y0 - y2) / (2 * denom)) : 0;
  const clamped = Math.max(-0.5, Math.min(0.5, Number.isFinite(offset) ? offset : 0));
  const peakBin = best + clamped;
  const peakHz = (peakBin * fps) / fftSize;
  return {
    bpm: peakHz * 60,
    peakHz,
    concentration: mag2[best] / bandPower,
    edge: best === kLo || best === kHi,
  };
}

/**
 * Estimate BPM from a 160-sample rPPG waveform at the given effective fps.
 * Returns bpm:null with a reason when the waveform cannot support a reading.
 * Never invents a value: flat, non-finite, edge-peaked, or segment-unstable
 * inputs are refused.
 */
export function estimateRppgHeartRate(
  waveform: ArrayLike<number>,
  fps: number,
): RppgHrEstimate {
  const n = (waveform as ArrayLike<number>).length;
  if (n === 0) {
    return { bpm: null, concentration: 0, segmentSpreadBpm: 0, peakHz: null, reason: 'EMPTY' };
  }
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const v = (waveform as ArrayLike<number>)[i];
    if (!Number.isFinite(v)) {
      return { bpm: null, concentration: 0, segmentSpreadBpm: 0, peakHz: null, reason: 'NON_FINITE' };
    }
    mean += v;
  }
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = (waveform as ArrayLike<number>)[i] - mean;
    variance += d * d;
  }
  variance /= n;
  if (!(variance > FLAT_VARIANCE_FLOOR)) {
    return { bpm: null, concentration: 0, segmentSpreadBpm: 0, peakHz: null, reason: 'FLAT' };
  }
  const full = spectrumPeak(waveform, fps);
  if (!full) {
    return { bpm: null, concentration: 0, segmentSpreadBpm: 0, peakHz: null, reason: 'EDGE_PEAK' };
  }
  if (full.edge) {
    return {
      bpm: null,
      concentration: full.concentration,
      segmentSpreadBpm: 0,
      peakHz: full.peakHz,
      reason: 'EDGE_PEAK',
    };
  }
  // Temporal stability: halves must agree with the full-window estimate.
  const half = Math.floor(n / 2);
  const first = spectrumPeak(
    Array.from({ length: half }, (_, i) => (waveform as ArrayLike<number>)[i]),
    fps,
  );
  const second = spectrumPeak(
    Array.from({ length: n - half }, (_, i) => (waveform as ArrayLike<number>)[half + i]),
    fps,
  );
  let spread = 0;
  const candidates = [full.bpm];
  if (first && !first.edge) candidates.push(first.bpm);
  if (second && !second.edge) candidates.push(second.bpm);
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      spread = Math.max(spread, Math.abs(candidates[i] - candidates[j]));
    }
  }
  if (spread > RPPG_HR_SEGMENT_AGREE_MAX_BPM) {
    return {
      bpm: null,
      concentration: full.concentration,
      segmentSpreadBpm: spread,
      peakHz: full.peakHz,
      reason: 'UNSTABLE_SEGMENTS',
    };
  }
  const bpm =
    full.bpm >= RPPG_HR_MIN_BPM && full.bpm <= RPPG_HR_MAX_BPM ? full.bpm : null;
  return {
    bpm,
    concentration: full.concentration,
    segmentSpreadBpm: spread,
    peakHz: full.peakHz,
    reason: bpm === null ? 'EDGE_PEAK' : null,
  };
}

/** Deterministic synthetic rPPG waveform for tests (NOT a measurement). */
export function buildSineWaveform(
  bpm: number,
  fps = 30,
  count = 160,
  noiseAmp = 0,
  seed = 7,
): Float32Array {
  const out = new Float32Array(count);
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    out[i] =
      Math.sin(2 * Math.PI * (bpm / 60) * t) +
      0.3 * Math.sin(2 * Math.PI * (bpm / 60) * 2 * t + 0.7) +
      noiseAmp * rand();
  }
  return out;
}
