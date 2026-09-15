/**
 * healthgraph-ppg signal-pipeline tests.
 *
 * Exercise the REAL reference implementation
 * (modules/healthgraph-ppg/src/ppgSignal.ts) — the same algorithm as the
 * native Kotlin/Swift pipeline — with synthetic pulse signals.
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/ppgSignal.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDebugSummary,
  cleanRR,
  detrend,
  detectPeaks,
  diagnosePpg,
  displayHrFromRecent,
  isStableHrSeries,
  liveHrFromWindow,
  lowPass,
  median,
  processPpgSignal,
  qualityComponents,
  refinePeak,
  rmssd,
  sampleTimeAt,
  sdnn,
  signalQuality,
} from '../modules/healthgraph-ppg/src/ppgSignal.ts';

/** Synthetic pulsatile signal: 72bpm sine-like pulses + noise, sampled at 30Hz. */
function syntheticPulse(bpm = 72, seconds = 60, fs = 30, noise = 0.15): { s: number[]; t: number[] } {
  const n = seconds * fs;
  const s: number[] = new Array(n);
  const t: number[] = new Array(n);
  const period = 60 / bpm;
  // Deterministic pseudo-noise (seeded LCG) — no flaky Math.random.
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const time = i / fs;
    const phase = (time % period) / period;
    // Systolic upstroke + diastolic decay shape.
    const pulse = Math.exp(-Math.pow((phase - 0.15) * 8, 2)) + 0.4 * Math.exp(-Math.pow((phase - 0.35) * 6, 2));
    s[i] = 100 + 6 * pulse + noise * 6 * rand();
    t[i] = Math.round(time * 1000);
  }
  return { s, t };
}

/** Same pulse with a slow sinusoidal baseline wander (auto-exposure model). */
function syntheticPulseWithDrift(
  bpm = 74,
  seconds = 60,
  fs = 30,
  noise = 0.15,
  driftAmp = 3,
  driftPeriodSeconds = 25,
): { s: number[]; t: number[] } {
  const { s, t } = syntheticPulse(bpm, seconds, fs, noise);
  for (let i = 0; i < s.length; i++) {
    s[i] += driftAmp * Math.sin((2 * Math.PI * (i / fs)) / driftPeriodSeconds);
  }
  return { s, t };
}

/** Same pulse with timestamp jitter + a non-integer frame rate. */
function syntheticPulseJittered(
  bpm = 74,
  seconds = 30,
  fs = 27.5,
  noise = 0.15,
): { s: number[]; t: number[] } {
  const n = Math.round(seconds * fs);
  const s: number[] = new Array(n);
  const t: number[] = new Array(n);
  const period = 60 / bpm;
  let seed = 1234;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const time = i / fs;
    const phase = (time % period) / period;
    const pulse = Math.exp(-Math.pow((phase - 0.15) * 8, 2)) + 0.4 * Math.exp(-Math.pow((phase - 0.35) * 6, 2));
    s[i] = 100 + 6 * pulse + noise * 6 * rand();
    // Ideal schedule plus ±8ms delivery jitter (real CameraX behavior).
    t[i] = Math.round(time * 1000 + rand() * 16);
  }
  return { s, t };
}

test('lowPass smooths while preserving DC level', () => {
  const { s } = syntheticPulse(72, 5);
  const f = lowPass(s);
  assert.equal(f.length, s.length);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.abs(mean(f) - mean(s)) < 0.5);
});

test('detectPeaks finds ~expected beats for clean pulse', () => {
  const { s } = syntheticPulse(72, 30, 30, 0.02);
  const peaks = detectPeaks(lowPass(s), 30);
  // 30s @ 72bpm = 36 beats; allow ±20%.
  assert.ok(peaks.length >= 28 && peaks.length <= 44, `peaks=${peaks.length}`);
});

test('processPpgSignal recovers HR within tolerance', () => {
  const { s, t } = syntheticPulse(72, 60);
  const out = processPpgSignal(s, t, 60);
  assert.ok(out.heartRateBpm != null, `hr=${out.heartRateBpm} q=${out.signalQuality}`);
  assert.ok(Math.abs(out.heartRateBpm! - 72) <= 5, `hr=${out.heartRateBpm}`);
  assert.ok(out.signalQuality >= 0.5, `q=${out.signalQuality}`);
  assert.ok(out.rmssdMs != null && out.sdnnMs != null);
  assert.ok(out.rrIntervalsMs.length >= 5);
});

test('flat signal yields null HR and zero quality (never fabricated)', () => {
  const n = 60 * 30;
  const s = new Array(n).fill(100);
  const t = s.map((_, i) => Math.round((i / 30) * 1000));
  const out = processPpgSignal(s, t, 60);
  assert.equal(out.heartRateBpm, null);
  assert.equal(out.signalQuality, 0);
});

test('short measurement gates HRV off but can still give HR', () => {
  const { s, t } = syntheticPulse(80, 15);
  const out = processPpgSignal(s, t, 15);
  assert.equal(out.rmssdMs, null);
  assert.equal(out.sdnnMs, null);
});

test('rmssd/sdnn match textbook definitions', () => {
  const rr = [800, 820, 790, 810];
  const r = rmssd(rr)!;
  const expectedRmssd = Math.sqrt((400 + 900 + 400) / 3);
  assert.ok(Math.abs(r - expectedRmssd) < 1e-9);
  const m = 805;
  const expectedSdnn = Math.sqrt((25 + 225 + 225 + 25) / 4);
  assert.ok(Math.abs(sdnn(rr)! - expectedSdnn) < 1e-9);
});

test('cleanRR rejects artifacts and keeps physiology', () => {
  const cleaned = cleanRR([800, 810, 50, 795, 3000, 805]);
  assert.deepEqual(cleaned, [800, 810, 795, 805]);
});

test('signalQuality is bounded in [0,1]', () => {
  const { s } = syntheticPulse(72, 10);
  const q = signalQuality(s, 9, 10);
  assert.ok(q >= 0 && q <= 1);
  assert.equal(signalQuality([], 0, 60), 0);
});

// ── Reliability increment: real-device failure modes ────────────────
// Each test below pins one discovered root cause so it cannot regress.

test('R1: stable 74bpm pulse converges near the true HR (no 64–68 wander)', () => {
  const { s, t } = syntheticPulse(74, 60, 30, 0.15);
  const out = processPpgSignal(s, t, 60);
  assert.ok(out.heartRateBpm != null, `hr=${out.heartRateBpm} q=${out.signalQuality}`);
  assert.ok(Math.abs(out.heartRateBpm! - 74) <= 3, `hr=${out.heartRateBpm} (want ~74)`);
  assert.ok(out.signalQuality >= 0.5, `q=${out.signalQuality}`);
});

test('R1b: sub-sample refinement removes integer-grid bias (70/74/80)', () => {
  for (const bpm of [60, 70, 74, 80, 100]) {
    const { s, t } = syntheticPulse(bpm, 30, 30, 0);
    const out = processPpgSignal(s, t, 30);
    assert.ok(
      out.heartRateBpm != null && Math.abs(out.heartRateBpm - bpm) <= 1.5,
      `true=${bpm} got=${out.heartRateBpm}`,
    );
  }
});

test('R1c: median HR survives a single mistimed peak (74 stays 74, not 71)', () => {
  // One interval stretched +16% (a drift-edge miss / double-count artifact).
  const rr = [810, 810, 940, 810, 810];
  assert.equal(median(rr), 810);
  assert.ok(Math.abs(60000 / median(rr) - 74.1) < 0.5);
  // The mean would report ~71.8 — the old discrepancy class.
  const m = rr.reduce((a, b) => a + b, 0) / rr.length;
  assert.ok(60000 / m < 72.5);
});

test('R2: slightly varying valid HR 70→72→74→72→73 is accepted', () => {
  assert.equal(isStableHrSeries([70, 72, 74, 72, 73]), true);
});

test('R3: grossly unstable 119→83→61→108→57 is rejected, never smoothed', () => {
  const wild = [119, 83, 61, 108, 57];
  assert.equal(isStableHrSeries(wild), false);
  // Display smoothing must not launder it either: without the stability
  // gate there is no display value. The median-of-3 helper is arithmetic
  // only — the session must still refuse to show it.
  assert.equal(isStableHrSeries(wild.slice(-3).concat([61, 108])), false);
});

test('R4: display smoothing hides tick jitter but keeps real estimates', () => {
  assert.equal(displayHrFromRecent([]), null);
  assert.equal(displayHrFromRecent([72]), 72);
  // Median of last 3: 72,74,72 -> 72 (single-tick 74 does not move display).
  assert.equal(displayHrFromRecent([71, 72, 74, 72]), 72);
});

test('R6: baseline drift does not destroy the pulse (74 stays detectable)', () => {
  const { s, t } = syntheticPulseWithDrift(74, 60, 30, 0.15, 3, 25);
  const out = processPpgSignal(s, t, 60);
  assert.ok(out.heartRateBpm != null, `drift killed HR: q=${out.signalQuality}`);
  assert.ok(Math.abs(out.heartRateBpm! - 74) <= 5, `hr=${out.heartRateBpm} (want ~74)`);
  // Rolling 10s live windows over the drifted signal stay converged.
  const live: number[] = [];
  for (let end = 10000; end <= 60000; end += 2000) {
    const hr = liveHrFromWindow(s.slice(0, Math.round((end / 1000) * 30)), t.slice(0, Math.round((end / 1000) * 30)), 10);
    if (hr != null) live.push(hr);
  }
  assert.ok(live.length >= 5, `need live estimates, got ${live.length}`);
  for (const hr of live) {
    assert.ok(Math.abs(hr - 74) <= 5, `live hr=${hr} drifted from 74`);
  }
  assert.ok(isStableHrSeries(live), `drifted stream must vote stable: [${live.join(',')}]`);
});

test('R6b: detrend removes slow wander while preserving pulse energy', () => {
  const { s } = syntheticPulseWithDrift(74, 30, 30, 0.02, 5, 25);
  const d = detrend(s, 30);
  assert.equal(d.length, s.length);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  // Residual is zero-mean AC (drift gone)…
  assert.ok(Math.abs(mean(d)) < 0.5, `detrended mean=${mean(d)}`);
  // …with surviving pulse-scale energy (not flattened to noise).
  const std = Math.sqrt(mean(d.map((x) => (x - mean(d)) ** 2)));
  assert.ok(std > 1 && std < 5, `detrended std=${std}`);
});

test('R6c: drift discount is honest — clean pulse over wander still passes', () => {
  const { s } = syntheticPulseWithDrift(74, 30, 30, 0.05, 3, 25);
  const fs = 30;
  const peaks = detectPeaks(lowPass(detrend(s, fs)), fs);
  assert.ok(peaks.length >= 20, `need beats under drift, got ${peaks.length}`);
  const c = qualityComponents(s, peaks.length, 30, fs);
  assert.ok(c.driftCv > 0.005, `expected measurable drift, got ${c.driftCv}`);
  assert.ok(c.driftFactor >= 0.3 && c.driftFactor <= 1, `drift=${c.driftFactor}`);
  const q = signalQuality(s, peaks.length, 30);
  assert.ok(q >= 0.5, `clean pulse over mild wander must pass, q=${q}`);
});

test('R7: frame-rate variation + jitter stays correct via timestamps', () => {
  const { s, t } = syntheticPulseJittered(74, 30, 27.5, 0.15);
  const out = processPpgSignal(s, t, 30);
  assert.ok(out.heartRateBpm != null, `hr=${out.heartRateBpm} q=${out.signalQuality}`);
  assert.ok(Math.abs(out.heartRateBpm! - 74) <= 5, `hr=${out.heartRateBpm} (want ~74)`);
});

test('R8: dropped frames (10% gaps) never crash and never fabricate', () => {
  const { s, t } = syntheticPulse(74, 30, 30, 0.15);
  const s2: number[] = [];
  const t2: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (i % 10 === 9) continue; // drop every 10th frame
    s2.push(s[i]!);
    t2.push(t[i]!);
  }
  const out = processPpgSignal(s2, t2, 30);
  // Either a near-true HR or an honest null — never a wild fabrication.
  if (out.heartRateBpm != null) {
    assert.ok(
      out.heartRateBpm >= 40 && out.heartRateBpm <= 150,
      `fabricated hr=${out.heartRateBpm}`,
    );
    assert.ok(out.signalQuality >= 0.5);
  } else {
    assert.ok(out.signalQuality < 0.5 || out.rrIntervalsMs.length < 2);
  }
});

test('R9: zero/invalid input never crashes and never yields BPM', () => {
  assert.equal(processPpgSignal([], [], 60).heartRateBpm, null);
  assert.equal(processPpgSignal([1, 2, 3], [0, 33], 60).heartRateBpm, null);
  const n = 300;
  const nanS = new Array(n).fill(NaN);
  const nanT = new Array(n).fill(0).map((_, i) => i * 33);
  assert.equal(processPpgSignal(nanS, nanT, 10).heartRateBpm, null);
  assert.equal(signalQuality(nanS, 0, 10), 0);
  assert.deepEqual(detectPeaks([], 30), []);
  assert.deepEqual(detrend([], 30), []);
});

test('R10: no finger (empty/insufficient signal) yields no BPM', () => {
  const out = processPpgSignal([], [], 60);
  assert.equal(out.heartRateBpm, null);
  assert.equal(out.signalQuality, 0);
  // A short, fingerless-equivalent snippet stays null at the live gate.
  assert.equal(liveHrFromWindow([1, 2, 3, 4], [0, 33, 66, 99], 10), null);
});

test('R11: live BPM requires sufficient valid signal (no stale display)', () => {
  // 3s of perfect pulse is real signal but insufficient for a live window.
  const { s, t } = syntheticPulse(74, 3, 30, 0.02);
  assert.equal(liveHrFromWindow(s, t, 10), null);
  // 12s of perfect pulse produces a real live value near truth.
  const full = syntheticPulse(74, 12, 30, 0.05);
  const hr = liveHrFromWindow(full.s, full.t, 10);
  assert.ok(hr != null && Math.abs(hr - 74) <= 5, `live=${hr}`);
});

test('R-refine: parabolic refinement interpolates a known peak', () => {
  // Symmetric parabola peak at index 5: refinement stays ~5.
  const sym = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map(Number);
  assert.ok(Math.abs(refinePeak(sym, 5) - 5) < 1e-9);
  // Right shoulder higher: fractional position shifts right, bounded.
  const asym = [0, 1, 2, 3, 4, 5, 4.9, 3, 2, 1, 0].map(Number);
  const r = refinePeak(asym, 5);
  assert.ok(r > 5 && r <= 5.5, `refined=${r}`);
  // Edges are returned unrefined, never crash.
  assert.equal(refinePeak(sym, 0), 0);
  assert.equal(refinePeak(sym, sym.length - 1), sym.length - 1);
  // sampleTimeAt interpolates the real clock.
  assert.equal(sampleTimeAt([0, 100, 200], 1.5), 150);
  assert.equal(sampleTimeAt([0, 100, 200], 0), 0);
});

test('R-diag: diagnostics + debug summary expose signal facts, never imagery', () => {
  const { s, t } = syntheticPulseWithDrift(74, 30, 30, 0.1, 2, 25);
  const out = processPpgSignal(s, t, 30);
  const span = t[t.length - 1]! - t[0]!;
  const fs = (s.length - 1) / (span / 1000);
  const d = diagnosePpg(s, 30, fs, out.peakCount, out.rrIntervalsMs);
  assert.equal(d.sampleCount, s.length);
  assert.ok(d.peakCount > 10, `peaks=${d.peakCount}`);
  assert.ok(d.rrMedianMs != null && Math.abs(d.rrMedianMs - 810) < 60, `rrMed=${d.rrMedianMs}`);
  const summary = buildDebugSummary({
    fingerPresencePct: 96,
    framesReceived: 900,
    samplesAccepted: 880,
    framesRejected: 20,
    effectiveFps: 29.4,
    diagnostics: d,
    rawHrEstimates: [72, 73, 74, 72, 73],
    displayedHr: 73,
    finalHr: 73,
    failureReason: null,
    stable: true,
  });
  for (const line of [
    'PPG DEBUG SUMMARY',
    'Finger presence: 96%',
    'Frames: 900',
    'FPS: 29.4',
    'Quality:',
    'Peaks:',
    'RR median:',
    'Raw HR estimates: 72, 73, 74, 72, 73',
    'Final HR: 73',
    'Stability: PASS',
  ]) {
    assert.ok(summary.includes(line), `summary missing "${line}"`);
  }
  const rejected = buildDebugSummary({
    fingerPresencePct: 40,
    framesReceived: 900,
    samplesAccepted: 200,
    framesRejected: 100,
    effectiveFps: 29.4,
    diagnostics: d,
    rawHrEstimates: [64, 68, 91, 62, 83],
    displayedHr: null,
    finalHr: null,
    failureReason: 'UNSTABLE',
    stable: false,
  });
  assert.ok(rejected.includes('Final HR: REJECTED (UNSTABLE)'));
  assert.ok(rejected.includes('Stability: FAIL'));
});
