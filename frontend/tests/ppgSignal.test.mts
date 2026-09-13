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
  cleanRR,
  detectPeaks,
  lowPass,
  processPpgSignal,
  rmssd,
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
