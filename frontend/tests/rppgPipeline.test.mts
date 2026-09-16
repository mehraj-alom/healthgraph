/**
 * rppgPipeline — unit/contract tests for the face-rPPG capture pipeline.
 *
 * Covers (all pure TypeScript, no device, no network):
 * - window-file contract parity (services/rppg vs healthgraph-rppg native)
 * - window parse/build round-trip + structural rejections
 * - face tracker states (stable/absent/shaky/dark) + screen-state mapping
 * - preprocessor layout (BGR planes, normalization) + refusals
 *   (incomplete window, unsupported fps)
 * - spectral HR estimation (synthetic waves, flat/NaN/empty rejection,
 *   no invented values)
 * - quality gating (reliable/borderline/insufficient)
 * - persistence reliability flag
 *
 * Imports are intentionally extensionless (Metro canonical form), so this
 * file runs via a throwaway transpile to /tmp. From `frontend/`:
 *   rm -rf /tmp/rppgpipe /tmp/rppgpipe-out && mkdir -p /tmp/rppgpipe && \
 *   cp --parents tests/rppgPipeline.test.mts \
 *     src/services/rppg/types.ts src/services/rppg/validation.ts \
 *     src/services/rppg/frameWindow.ts src/services/rppg/faceTracker.ts \
 *     src/services/rppg/preprocessor.ts src/services/rppg/hrEstimator.ts \
 *     src/services/rppg/qualityGate.ts \
 *     modules/healthgraph-rppg/src/HealthGraphRPPG.types.ts /tmp/rppgpipe/ && \
 *   mv /tmp/rppgpipe/tests/rppgPipeline.test.mts /tmp/rppgpipe/tests/rppgPipeline.test.ts && \
 *   ./node_modules/.bin/tsc --ignoreConfig --ignoreDeprecations 6.0 \
 *     /tmp/rppgpipe/tests/rppgPipeline.test.ts --rootDir /tmp/rppgpipe \
 *     --outDir /tmp/rppgpipe-out --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck --noCheck --declaration false \
 *     --sourceMap false && \
 *   node --test /tmp/rppgpipe-out/tests/rppgPipeline.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RPPG_FPS_MAX,
  RPPG_FPS_MIN,
  RPPG_WINDOW_FRAMES,
  RPPG_WINDOW_MAGIC,
  RPPG_WINDOW_ROI,
  RPPG_WINDOW_VERSION,
} from '../src/services/rppg/types';
import {
  RPPG_WINDOW_FRAMES as NATIVE_FRAMES,
  RPPG_WINDOW_MAGIC as NATIVE_MAGIC,
  RPPG_WINDOW_ROI as NATIVE_ROI,
  RPPG_WINDOW_VERSION as NATIVE_VERSION,
  RPPG_FPS_MIN as NATIVE_FPS_MIN,
  RPPG_FPS_MAX as NATIVE_FPS_MAX,
} from '../modules/healthgraph-rppg/src/HealthGraphRPPG.types';
import {
  buildRppgWindowForTests,
  parseRppgWindow,
  readRppgWindowFile,
} from '../src/services/rppg/frameWindow';
import {
  buildTelemetryFixture,
  FaceTracker,
  mapNativeCaptureState,
} from '../src/services/rppg/faceTracker';
import { measuredFps, preprocessWindow, preprocessWindowYielding } from '../src/services/rppg/preprocessor';
import {
  buildSineWaveform,
  estimateRppgHeartRate,
} from '../src/services/rppg/hrEstimator';
import {
  gateRppgQuality,
  rppgReliableForPersistence,
} from '../src/services/rppg/qualityGate';

test('window contract parity: TS boundary matches the native module', () => {
  assert.equal(RPPG_WINDOW_MAGIC, NATIVE_MAGIC);
  assert.equal(RPPG_WINDOW_VERSION, NATIVE_VERSION);
  assert.equal(RPPG_WINDOW_FRAMES, NATIVE_FRAMES);
  assert.equal(RPPG_WINDOW_ROI, NATIVE_ROI);
  assert.equal(RPPG_FPS_MIN, NATIVE_FPS_MIN);
  assert.equal(RPPG_FPS_MAX, NATIVE_FPS_MAX);
});

test('window round-trip: build 160 frames, parse back exactly', () => {
  const bytes = buildRppgWindowForTests(160, 30, (f, b) => (f * 31 + b) & 0xff);
  const w = parseRppgWindow(bytes);
  assert.equal(w.frameCount, 160);
  assert.equal(w.roiSize, 128);
  assert.ok(Math.abs(w.fps - 30) < 0.01);
  assert.equal(w.timestampsMs.length, 160);
  assert.equal(w.bgr.length, 160 * 128 * 128 * 3);
  // Byte fidelity of a sample frame.
  const base = 17 * 128 * 128 * 3;
  assert.equal(w.bgr[base], (17 * 31) & 0xff);
  assert.equal(w.bgr[base + 1], (17 * 31 + 1) & 0xff);
});

test('window rejections: magic, version, length, monotonicity', () => {
  const good = buildRppgWindowForTests(160, 30, () => 128);
  const badMagic = good.slice();
  badMagic[0] = 0x58;
  assert.throws(() => parseRppgWindow(badMagic), /bad magic/);
  const badLen = good.slice(0, good.length - 100);
  assert.throws(() => parseRppgWindow(badLen), /byte length/);
  const tiny = new Uint8Array(4);
  assert.throws(() => parseRppgWindow(tiny), /truncated/);
  assert.throws(
    () => parseRppgWindow('nope' as unknown as Uint8Array),
    /Uint8Array/,
  );
  // Non-monotonic timestamps.
  const skewed = buildRppgWindowForTests(160, 30, () => 128);
  const view = new DataView(skewed.buffer);
  view.setFloat64(14 + 5 * (8 + 128 * 128 * 3), -1000, true);
  assert.throws(() => parseRppgWindow(skewed), /monotonic/);
});

test('window reader: injected bytes + empty URI refused', async () => {
  const bytes = buildRppgWindowForTests(160, 30, () => 100);
  const w = await readRppgWindowFile('file:///cache/x.bin', async () => bytes);
  assert.equal(w.frameCount, 160);
  await assert.rejects(() => readRppgWindowFile(''), /non-empty/);
});

test('face tracker: stable face acquires, absence loses, shake/dark guide', () => {
  const t = new FaceTracker();
  let snap = t.observe(buildTelemetryFixture(1, 'stable')[0]);
  assert.equal(snap.state, 'FIND_FACE');
  for (const s of buildTelemetryFixture(10, 'stable')) snap = t.observe(s);
  assert.equal(snap.state, 'ACQUIRING');
  assert.ok(snap.stableFrac > 0.8);

  const lost = new FaceTracker();
  for (const s of buildTelemetryFixture(40, 'absent')) snap = lost.observe(s);
  assert.equal(snap.state, 'FACE_LOST');

  const shaky = new FaceTracker();
  for (const s of buildTelemetryFixture(12, 'stable')) snap = shaky.observe(s);
  assert.equal(snap.state, 'ACQUIRING');
  for (const s of buildTelemetryFixture(20, 'shaky')) snap = shaky.observe(s);
  assert.notEqual(snap.state, 'ACQUIRING');

  const dark = new FaceTracker();
  for (const s of buildTelemetryFixture(12, 'dark')) snap = dark.observe(s);
  assert.notEqual(snap.state, 'ACQUIRING');
});

test('screen-state mapping covers every native state', () => {
  assert.equal(mapNativeCaptureState('STARTING', null), 'PREPARING');
  assert.equal(mapNativeCaptureState('FIND_FACE', null), 'FIND_FACE');
  assert.equal(mapNativeCaptureState('POSITION_FACE', 0.5), 'POSITION_FACE');
  assert.equal(mapNativeCaptureState('ACQUIRING', 0.9), 'ACQUIRING');
  assert.equal(mapNativeCaptureState('ACQUIRING', 0.1), 'SIGNAL_WEAK');
  assert.equal(mapNativeCaptureState('FACE_LOST', null), 'FACE_LOST');
  assert.equal(mapNativeCaptureState('COMPLETING', null), 'COMPLETING');
  assert.equal(mapNativeCaptureState('COMPLETE', null), 'COMPLETING');
  assert.equal(mapNativeCaptureState('FAILED', null), 'FAILED');
  assert.equal(mapNativeCaptureState('CANCELLED', null), 'IDLE');
});

test('preprocessor: exact BGR layout + normalization', () => {
  // Frame f: B=f, G=f+1, R=f+2 pattern via byte position.
  const bytes = buildRppgWindowForTests(160, 30, (f, b) => (f + (b % 3)) & 0xff);
  const w = parseRppgWindow(bytes);
  const { input, fpsMeasured } = preprocessWindow(w);
  assert.deepEqual([...input.dims], [1, 3, 160, 128, 128]);
  assert.equal(input.dtype, 'float32');
  assert.ok(input.data instanceof Float32Array);
  assert.equal(input.data.length, 1 * 3 * 160 * 128 * 128);
  assert.ok(Math.abs(fpsMeasured - 30) < 0.01);
  const P = 128 * 128;
  const norm = (v: number) => (v - 127.5) / 128;
  // Pixel 0 of frame 7: B=7, G=8, R=9 → channels 0/1/2.
  assert.equal(input.data[7 * P + 0], norm(7));
  assert.equal(input.data[P * 160 + 7 * P + 0], norm(8));
  assert.equal(input.data[2 * P * 160 + 7 * P + 0], norm(9));
  // No NaN anywhere.
  for (let i = 0; i < input.data.length; i += 4096) {
    assert.ok(Number.isFinite(input.data[i]));
  }
});

test('preprocessor yielding variant: bit-identical tensor, same refusals', async () => {
  const bytes = buildRppgWindowForTests(160, 30, (f, b) => (f * 3 + b * 7) & 0xff);
  const w = parseRppgWindow(bytes);
  const sync = preprocessWindow(w);
  const chunked = await preprocessWindowYielding(w);
  assert.deepEqual([...chunked.input.dims], [...sync.input.dims]);
  assert.equal(chunked.input.dtype, sync.input.dtype);
  assert.equal(chunked.fpsMeasured, sync.fpsMeasured);
  assert.equal(chunked.input.data.length, sync.input.data.length);
  for (let i = 0; i < sync.input.data.length; i++) {
    assert.equal(chunked.input.data[i], sync.input.data[i], `tensor differs at ${i}`);
  }
  // Same refusal contract as the sync reference.
  const short = parseRppgWindow(buildRppgWindowForTests(120, 30, () => 128));
  await assert.rejects(() => preprocessWindowYielding(short), /exactly 160/);
  const slow = parseRppgWindow(buildRppgWindowForTests(160, 15, () => 128));
  await assert.rejects(() => preprocessWindowYielding(slow), /outside the supported/);
});

test('preprocessor refusals: incomplete window, unsupported fps', () => {
  const short = parseRppgWindow(buildRppgWindowForTests(120, 30, () => 128));
  assert.throws(() => preprocessWindow(short), /exactly 160/);
  const slow = parseRppgWindow(buildRppgWindowForTests(160, 15, () => 128));
  assert.throws(() => preprocessWindow(slow), /outside the supported/);
  const fast = parseRppgWindow(buildRppgWindowForTests(160, 60, () => 128));
  assert.throws(() => preprocessWindow(fast), /outside the supported/);
  assert.equal(measuredFps([]), null);
  assert.equal(measuredFps([100]), null);
});

test('HR estimator: synthetic pulse recovered, garbage refused', () => {
  const w72 = buildSineWaveform(72, 30, 160, 0.05);
  const e72 = estimateRppgHeartRate(w72, 30);
  assert.ok(e72.bpm !== null && Math.abs(e72.bpm - 72) < 2, `bpm=${e72.bpm}`);
  assert.ok(e72.concentration > 0.3, `conc=${e72.concentration}`);
  const w120 = buildSineWaveform(120, 30, 160, 0.05);
  const e120 = estimateRppgHeartRate(w120, 30);
  assert.ok(e120.bpm !== null && Math.abs(e120.bpm - 120) < 2.5, `bpm=${e120.bpm}`);

  const flat = new Float32Array(160).fill(0.5);
  assert.equal(estimateRppgHeartRate(flat, 30).reason, 'FLAT');
  const nan = buildSineWaveform(72, 30, 160, 0);
  nan[50] = Number.NaN;
  assert.equal(estimateRppgHeartRate(nan, 30).reason, 'NON_FINITE');
  assert.equal(estimateRppgHeartRate(new Float32Array(0), 30).reason, 'EMPTY');

  // Heavy noise: must not invent a confident reading.
  const noisy = buildSineWaveform(72, 30, 160, 3.0);
  const en = estimateRppgHeartRate(noisy, 30);
  assert.ok(
    en.bpm === null || en.concentration < 0.35,
    `noisy bpm=${en.bpm} conc=${en.concentration}`,
  );
});

test('quality gate: reliable / borderline / insufficient', () => {
  const goodHr = { bpm: 72, concentration: 0.55, segmentSpreadBpm: 1.5, peakHz: 1.2, reason: null };
  const good = gateRppgQuality({
    faceStableFrac: 0.95,
    droppedFrac: 0.02,
    fpsMeasured: 30,
    waveformVariance: 0.02,
    hr: goodHr,
  });
  assert.equal(good.level, 'reliable');

  const mid = gateRppgQuality({
    faceStableFrac: 0.6,
    droppedFrac: 0.1,
    fpsMeasured: 29,
    waveformVariance: 0.01,
    hr: { ...goodHr, concentration: 0.22 },
  });
  assert.equal(mid.level, 'borderline');

  const bad = gateRppgQuality({
    faceStableFrac: 0.2,
    droppedFrac: 0.4,
    fpsMeasured: 30,
    waveformVariance: 0.01,
    hr: { bpm: null, concentration: 0.05, segmentSpreadBpm: 0, peakHz: null, reason: 'FLAT' },
  });
  assert.equal(bad.level, 'insufficient');
  assert.ok(bad.reasons.length > 0);
});

test('persistence reliability flag mirrors the documented rule', () => {
  assert.equal(rppgReliableForPersistence(72, 0.8, 6), true);
  assert.equal(rppgReliableForPersistence(null, 0.8, 6), false);
  assert.equal(rppgReliableForPersistence(72, 0.3, 6), false);
  assert.equal(rppgReliableForPersistence(72, 0.8, 3), false);
});
