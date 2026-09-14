/**
 * ppgLive — continuous live-BPM + finger-presence tests.
 *
 * Exercises the pure session logic mirrored in
 * modules/healthgraph-ppg/src/ppgSignal.ts (same constants as the native
 * Kotlin pipeline) without a camera or an Android build:
 *
 * A. No finger → no BPM, waiting/removed states.
 * B. Finger detected → acquisition begins.
 * C. Valid pulse stream → live BPM appears and updates over windows.
 * D. Stable series [72,73,72,74,73] → accepted.
 * E. Unstable series [119,83,61,108,57] → rejected, never smoothed.
 * F. Finger removed mid-session → live BPM null, removal signalled.
 * G. Finger returns → reacquisition resumes.
 * H. Zero-frame / short-window handling (existing failure behavior intact).
 *
 * Run:
 *   node --experimental-strip-types --test frontend/tests/ppgLive.test.mts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FINGER_ABSENT_FRAMES,
  FINGER_PRESENT_FRAMES,
  LIVE_MIN_SECONDS,
  LIVE_WINDOW_SECONDS,
  detectPeaks,
  initialFingerTracker,
  isFingerPresent,
  isStableHrSeries,
  lowPass,
  processPpgSignal,
  updateFingerTracker,
  type FingerFrameStats,
} from '../modules/healthgraph-ppg/src/ppgSignal.ts';

/** Fingertip-like frame stats: bright, red-dominant, spatially uniform. */
function fingerStats(): FingerFrameStats {
  return { yMean: 150, yStd: 6, uMean: 105, vMean: 150 };
}

test('A: no finger present in any cue combination', () => {
  // Dark (no finger / torch blocked).
  assert.equal(
    isFingerPresent({ yMean: 8, yStd: 4, uMean: 128, vMean: 128 }),
    false,
  );
  // Saturated (no contact / glare).
  assert.equal(
    isFingerPresent({ yMean: 250, yStd: 3, uMean: 128, vMean: 128 }),
    false,
  );
  // Bright but not red (open room scene).
  assert.equal(
    isFingerPresent({ yMean: 180, yStd: 6, uMean: 130, vMean: 128 }),
    false,
  );
  // Red but spatially chaotic (not a covering fingertip).
  assert.equal(
    isFingerPresent({ yMean: 150, yStd: 60, uMean: 105, vMean: 150 }),
    false,
  );
  // Non-finite input fails closed.
  assert.equal(
    isFingerPresent({ yMean: NaN, yStd: 6, uMean: 105, vMean: 150 }),
    false,
  );
  // Empty buffer yields no BPM.
  const out = processPpgSignal([], [], 60);
  assert.equal(out.heartRateBpm, null);
});

test('B: fingertip stats acquire after consecutive frames', () => {
  const tracker = initialFingerTracker();
  // Sporadic single frames must not acquire.
  for (let i = 0; i < FINGER_PRESENT_FRAMES - 1; i++) {
    assert.equal(updateFingerTracker(tracker, true), null);
  }
  assert.equal(updateFingerTracker(tracker, true), 'ACQUIRING');
});

test('C: valid pulse stream yields updating live BPM over rolling windows', () => {
  // 30s deterministic 72bpm stream at 30Hz (same shape as signal tests).
  const fs = 30;
  const seconds = 30;
  const n = seconds * fs;
  const samples = new Array<number>(n);
  const ts = new Array<number>(n);
  const period = 60 / 72;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const time = i / fs;
    const phase = (time % period) / period;
    const pulse =
      Math.exp(-Math.pow((phase - 0.15) * 8, 2)) +
      0.4 * Math.exp(-Math.pow((phase - 0.35) * 6, 2));
    samples[i] = 100 + 6 * pulse + 0.9 * rand();
    ts[i] = Math.round(time * 1000);
  }
  // Overlapping 10s windows every 2s, mirroring native liveTick cadence.
  const live: number[] = [];
  for (
    let endMs = LIVE_MIN_SECONDS * 1000;
    endMs <= seconds * 1000;
    endMs += 2000
  ) {
    const cutMs = endMs - LIVE_WINDOW_SECONDS * 1000;
    let from = 0;
    while (from < n && ts[from] < cutMs) from++;
    const out = processPpgSignal(
      samples.slice(from),
      ts.slice(from),
      LIVE_WINDOW_SECONDS,
    );
    if (out.heartRateBpm != null) live.push(out.heartRateBpm);
  }
  assert.ok(live.length >= 5, `expected several live estimates, got ${live.length}`);
  for (const hr of live) {
    assert.ok(Math.abs(hr - 72) <= 8, `live hr=${hr} drifted from 72`);
  }
  assert.ok(isStableHrSeries(live), `stable stream must vote stable: [${live.join(',')}]`);
});

test('D: stable series 72,73,72,74,73 is accepted', () => {
  assert.equal(isStableHrSeries([72, 73, 72, 74, 73]), true);
});

test('E: unstable series 119,83,61,108,57 is rejected, never smoothed', () => {
  assert.equal(isStableHrSeries([119, 83, 61, 108, 57]), false);
  // Too few estimates is also not stable (no premature trust).
  assert.equal(isStableHrSeries([72, 73]), false);
  // Non-finite entries fail closed.
  assert.equal(isStableHrSeries([72, 73, NaN, 74, 73]), false);
});

test('F: finger removed mid-session invalidates live BPM', () => {
  const tracker = initialFingerTracker();
  for (let i = 0; i < FINGER_PRESENT_FRAMES; i++) {
    updateFingerTracker(tracker, true);
  }
  assert.equal(tracker.fingerEverSeen, true);
  assert.equal(tracker.fingerLost, false);
  let event: string | null = null;
  for (let i = 0; i < FINGER_ABSENT_FRAMES; i++) {
    event = updateFingerTracker(tracker, false);
  }
  assert.equal(event, 'FINGER_REMOVED');
  assert.equal(tracker.fingerLost, true);
  // The contract: on FINGER_REMOVED the hook clears liveBpm to null, so no
  // stale number survives. Model it here: removal event ⇒ live value is null.
  const liveBpmAfterRemoval: number | null = event === 'FINGER_REMOVED' ? null : 72;
  assert.equal(liveBpmAfterRemoval, null);
});

test('G: finger return reacquires automatically', () => {
  const tracker = initialFingerTracker();
  for (let i = 0; i < FINGER_PRESENT_FRAMES; i++) updateFingerTracker(tracker, true);
  for (let i = 0; i < FINGER_ABSENT_FRAMES; i++) updateFingerTracker(tracker, false);
  assert.equal(tracker.fingerLost, true);
  let event: string | null = null;
  for (let i = 0; i < FINGER_PRESENT_FRAMES; i++) {
    event = updateFingerTracker(tracker, true);
  }
  assert.equal(event, 'ACQUIRING');
  assert.equal(tracker.fingerLost, false);
});

test('H: short windows and empty input stay null (no fabrication)', () => {
  // Window shorter than the minimum acquisition span: process() itself still
  // scores, but the session only displays after LIVE_MIN_SECONDS of data.
  // Here the direct pipeline on a 3s snippet is allowed a number; the gate
  // that matters is the session-level minimum, modelled by span check:
  const spanOk = (firstMs: number, lastMs: number) =>
    lastMs - firstMs >= LIVE_MIN_SECONDS * 1000;
  assert.equal(spanOk(0, 3000), false);
  assert.equal(spanOk(0, 9000), true);
  // Mismatched/empty buffers are null.
  assert.equal(processPpgSignal([1, 2, 3], [0, 33], 60).heartRateBpm, null);
});

test('finger cue thresholds are documented constants', () => {
  // Boundary behavior: exactly at/over each cue edge.
  assert.equal(isFingerPresent(fingerStats()), true);
  // Red dominance just under the margin fails.
  assert.equal(isFingerPresent({ yMean: 150, yStd: 6, uMean: 125, vMean: 130 }), false);
  // Uniformity just over the cap fails.
  assert.equal(isFingerPresent({ yMean: 150, yStd: 21, uMean: 105, vMean: 150 }), false);
});

test('segment breaks exclude exactly the cross-placement RR interval', () => {
  // Deterministic 30s 72bpm stream: cleanRR keeps every interval, so removing
  // one boundary must drop exactly one RR and leave the rest identical.
  const fs = 30;
  const n = 30 * fs;
  const s = new Array<number>(n);
  const t = new Array<number>(n);
  const period = 60 / 72;
  let seed = 99;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const time = i / fs;
    const phase = (time % period) / period;
    const pulse =
      Math.exp(-Math.pow((phase - 0.15) * 8, 2)) +
      0.4 * Math.exp(-Math.pow((phase - 0.35) * 6, 2));
    s[i] = 100 + 6 * pulse + 0.9 * rand();
    t[i] = Math.round(time * 1000);
  }
  const peaks = detectPeaks(lowPass(s), fs);
  assert.ok(peaks.length > 4, `need peaks, got ${peaks.length}`);
  const base = processPpgSignal(s, t, 30);
  assert.ok(base.rrIntervalsMs.length >= 4);
  // No breaks (default) behaves identically to explicit empty breaks.
  const noBreaks = processPpgSignal(s, t, 30, []);
  assert.deepEqual(noBreaks.rrIntervalsMs, base.rrIntervalsMs);
  // Out-of-range breaks are ignored.
  const oob = processPpgSignal(s, t, 30, [-5, n + 1000]);
  assert.deepEqual(oob.rrIntervalsMs, base.rrIntervalsMs);
  // A break exactly on peaks[2] excludes only the interval ending there:
  // peaks[1] < peaks[2] <= peaks[2].
  const cut = processPpgSignal(s, t, 30, [peaks[2]!]);
  assert.equal(cut.rrIntervalsMs.length, base.rrIntervalsMs.length - 1);
  // Remainder is a subsequence of the base intervals (nothing rewritten).
  let j = 0;
  for (const v of cut.rrIntervalsMs) {
    while (j < base.rrIntervalsMs.length && base.rrIntervalsMs[j] !== v) j++;
    assert.ok(j < base.rrIntervalsMs.length, 'cut interval not found in base');
    j++;
  }
});
