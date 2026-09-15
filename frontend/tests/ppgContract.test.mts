/**
 * ppgContract — static contract tests for the PPG native bridge.
 *
 * Asserts the names, fields, codes, and honesty rules that MUST stay in sync
 * between the Android native module, the JS bridge, and the UI — without a
 * device or an EAS build:
 *
 * - native module / method / event names
 * - result payload field names (incl. torchEnabled/framesReceived/
 *   samplesCollected/failureReason)
 * - failureReason values and reject codes
 * - live session states (WAITING_FOR_FINGER/ACQUIRING/SIGNAL_WEAK/
 *   FINGER_REMOVED) and liveBpm event propagation
 * - heartRateBpm propagation + never-fabricated rule (q>=0.5 retained)
 * - simulated flagging + non-persistence guard
 * - cleanup behavior (torch off, observer/timeout removal, unbind)
 *
 * Kotlin/TS sources are read as TEXT (repo layout preserved in staging), so
 * this test never needs react-native, expo, or a camera.
 *
 * Run from `frontend/`:
 *   rm -rf /tmp/ppgcontract /tmp/ppgcontract-out && mkdir -p /tmp/ppgcontract && \
 *   cp --parents tests/ppgContract.test.mts \
 *     modules/healthgraph-ppg/src/HealthGraphPPG.types.ts \
 *     modules/healthgraph-ppg/src/HealthGraphPPGNative.ts \
 *     modules/healthgraph-ppg/src/ppgSignal.ts \
 *     modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/HealthGraphPPGModule.kt \
 *     modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgSignalProcessor.kt \
 *     src/services/ppg/simulatedProvider.ts \
 *     src/services/ppg/types.ts \
 *     src/services/ppgService.ts \
 *     src/hooks/usePpgMeasurement.ts /tmp/ppgcontract/ && \
 *   mv /tmp/ppgcontract/tests/ppgContract.test.mts /tmp/ppgcontract/tests/ppgContract.test.ts && \
 *   ./node_modules/.bin/tsc --ignoreConfig /tmp/ppgcontract/tests/ppgContract.test.ts \
 *     --rootDir /tmp/ppgcontract --outDir /tmp/ppgcontract-out --module commonjs \
 *     --target es2022 --esModuleInterop --skipLibCheck --noCheck \
 *     --rewriteRelativeImportExtensions --declaration false --sourceMap false && \
 *   node --test /tmp/ppgcontract-out/tests/ppgContract.test.js
 *
 * Stage (cp --parents) these files for the static reads below:
 *   tests/ppgContract.test.mts
 *   modules/healthgraph-ppg/src/HealthGraphPPG.types.ts
 *   modules/healthgraph-ppg/src/HealthGraphPPGNative.ts
 *   modules/healthgraph-ppg/src/PpgCameraPreview.tsx
 *   modules/healthgraph-ppg/src/ppgSignal.ts
 *   modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/HealthGraphPPGModule.kt
 *   modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgSignalProcessor.kt
 *   modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgCameraPreviewView.kt
 *   modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgPreviewHost.kt
 *   src/services/ppg/simulatedProvider.ts
 *   src/services/ppg/types.ts
 *   src/services/ppgService.ts
 *   src/hooks/usePpgMeasurement.ts
 *   src/screens/PpgMeasure/PpgMeasureScreen.tsx
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PPG_ALGORITHM_VERSION,
  PPG_FAILURE_REASONS,
  PPG_NATIVE_MODULE_NAME,
  PPG_STARTUP_REJECT_CODES,
  PPG_STATE_EVENT_NAME,
  PPG_COPY,
} from '../modules/healthgraph-ppg/src/HealthGraphPPG.types.ts';
import { processPpgSignal } from '../modules/healthgraph-ppg/src/ppgSignal.ts';
import { simulatedPpgProvider } from '../src/services/ppg/simulatedProvider.ts';

declare const __dirname: string;

function repoRoot(): string {
  const bases: string[] = [];
  try {
    if (typeof __dirname === 'string') bases.push(path.resolve(__dirname, '..'));
  } catch {
    // ESM/strip-types runtimes have no __dirname: fall through to cwd.
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'frontend'));
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, 'modules/healthgraph-ppg/src/HealthGraphPPG.types.ts'))) {
        return b;
      }
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('PPG repo root not found for contract sources');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const KOTLIN_MODULE = 'modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/HealthGraphPPGModule.kt';
const KOTLIN_PROCESSOR = 'modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgSignalProcessor.kt';
const KOTLIN_PREVIEW_VIEW = 'modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgCameraPreviewView.kt';
const KOTLIN_PREVIEW_HOST = 'modules/healthgraph-ppg/android/src/main/java/com/healthgraph/ppg/PpgPreviewHost.kt';
const BRIDGE = 'modules/healthgraph-ppg/src/HealthGraphPPGNative.ts';
const PREVIEW_TSX = 'modules/healthgraph-ppg/src/PpgCameraPreview.tsx';
const HOOK = 'src/hooks/usePpgMeasurement.ts';
const SERVICE = 'src/services/ppgService.ts';

test('native module, method, and event names match the contract', () => {
  assert.equal(PPG_NATIVE_MODULE_NAME, 'HealthGraphPPG');
  assert.equal(PPG_STATE_EVENT_NAME, 'HealthGraphPPGState');
  const kt = src(KOTLIN_MODULE);
  assert.ok(kt.includes('Name("HealthGraphPPG")'), 'module Name() registration');
  assert.ok(kt.includes('Events("HealthGraphPPGState")'), 'Events() registration');
  assert.ok(kt.includes('AsyncFunction("measure")'), 'measure method');
  assert.ok(kt.includes('AsyncFunction("cancel")'), 'cancel method');
});

test('result payload fields exist natively and cross the bridge', () => {
  const fields = [
    'heartRateBpm',
    'signalQuality',
    'durationSeconds',
    'algorithmVersion',
    'torchEnabled',
    'framesReceived',
    'samplesCollected',
    'failureReason',
    'debugSummary',
    'rrIntervalsMs',
    'rmssdMs',
    'sdnnMs',
  ];
  const kt = src(KOTLIN_MODULE);
  const bridge = src(BRIDGE);
  for (const f of fields) {
    assert.ok(kt.includes(`"${f}"`), `native result missing "${f}"`);
    assert.ok(bridge.includes(f), `bridge does not forward "${f}"`);
  }
});

test('failureReason values and reject codes match the native module', () => {
  assert.deepEqual([...PPG_FAILURE_REASONS], ['NO_SAMPLES', 'LOW_QUALITY', 'NO_BEATS', 'UNSTABLE']);
  const kt = src(KOTLIN_MODULE);
  for (const r of PPG_FAILURE_REASONS) {
    assert.ok(kt.includes(`"${r}"`), `native never emits failureReason ${r}`);
  }
  for (const code of PPG_STARTUP_REJECT_CODES) {
    // Either a direct promise.reject("CODE", ...) or the failRun("CODE", ...)
    // helper (which rejects with the code). Both end in '",'.
    assert.ok(
      kt.includes(`"${code}",`),
      `native never rejects with ${code}`,
    );
  }
  // No silent flash-less run: missing flash and unconfirmed torch fail fast.
  assert.ok(kt.includes('"NO_FLASH"'), 'NO_FLASH fail-fast missing');
  assert.ok(kt.includes('TORCH_CONFIRM_TIMEOUT_MS'), 'torch confirm timeout missing');
  assert.ok(kt.includes('torchState.observe'), 'TorchState observation missing');
});

test('cleanup releases torch, observer, timeout, and camera', () => {
  const kt = src(KOTLIN_MODULE);
  assert.ok(kt.includes('enableTorch(false)'), 'torch OFF on cleanup missing');
  assert.ok(kt.includes('removeObserver'), 'TorchState observer detach missing');
  assert.ok(kt.includes('removeCallbacks'), 'torch timeout cancel missing');
  assert.ok(kt.includes('unbindAll()'), 'camera unbind missing');
});

test('backgrounding ends the session (no orphan camera/torch)', () => {
  const screen = src('src/screens/PpgMeasure/PpgMeasureScreen.tsx');
  assert.ok(screen.includes('AppState'), 'AppState background handling missing');
  assert.ok(
    screen.includes("'background'"),
    'background cancel missing',
  );
});

test('quality threshold 0.5 is retained and never-fabricated rule holds', () => {
  const kt = src(KOTLIN_PROCESSOR);
  assert.ok(kt.includes('MIN_RELIABLE_QUALITY = 0.5f'), 'native threshold changed!');
  // Flat signal: null HR, zero quality — never a number.
  const n = 60 * 30;
  const flat = new Array(n).fill(100);
  const t = flat.map((_, i) => Math.round((i / 30) * 1000));
  const out = processPpgSignal(flat, t, 60);
  assert.equal(out.heartRateBpm, null);
  assert.equal(out.signalQuality, 0);
});

test('live session states and liveBpm cross the bridge', () => {
  const kt = src(KOTLIN_MODULE);
  for (const s of ['WAITING_FOR_FINGER', 'ACQUIRING', 'SIGNAL_WEAK', 'FINGER_REMOVED'] as const) {
    assert.ok(kt.includes(`"${s}"`), `native never emits ${s}`);
  }
  assert.ok(kt.includes('"liveBpm"'), 'native never emits liveBpm');
  const bridge = src(BRIDGE);
  assert.ok(bridge.includes('liveBpm'), 'bridge does not forward liveBpm');
  for (const s of ['WAITING_FOR_FINGER', 'ACQUIRING', 'SIGNAL_WEAK', 'FINGER_REMOVED'] as const) {
    assert.ok(typeof PPG_COPY[s] === 'string' && PPG_COPY[s].length > 0, `copy for ${s}`);
  }
  // Stability gate: wild sequences must be rejected, never smoothed.
  assert.ok(kt.includes('UNSTABLE'), 'UNSTABLE final gate missing');
  assert.ok(kt.includes('isStableHrSeries'), 'stability vote missing');
  assert.ok(kt.includes('isFingerPresent'), 'finger-presence vote missing');
  // Removal boundaries must not let stale beats contaminate reacquisition.
  assert.ok(kt.includes('segmentBreaks'), 'segment-break exclusion missing');
  const tsMirror = src('modules/healthgraph-ppg/src/ppgSignal.ts');
  assert.ok(tsMirror.includes('segmentBreaks'), 'TS mirror missing segment breaks');
});

test('simulated results are flagged and refused by persistence', () => {
  assert.equal(PPG_ALGORITHM_VERSION, 'ppg-1.1.0');
  const service = src(SERVICE);
  assert.ok(
    service.includes('Simulated PPG results cannot be saved'),
    'simulated persistence guard missing',
  );
  const hook = src(HOOK);
  assert.ok(
    hook.includes('if (r.heartRateBpm == null)'),
    'hook must skip persistence for null-HR runs',
  );
});

test('simulated provider never masquerades as real', async () => {
  const r = await simulatedPpgProvider.measure({ durationSeconds: 10 });
  assert.equal(r.simulated, true);
  assert.notEqual(r.algorithmVersion, PPG_ALGORITHM_VERSION);
  assert.ok(r.heartRateBpm != null, 'sim pipeline must still produce its demo number');
});

test('state copy covers every lifecycle state', () => {
  for (const s of [
    'IDLE',
    'STARTING',
    'WAITING_FOR_FINGER',
    'ACQUIRING',
    'MEASURING',
    'SIGNAL_WEAK',
    'FINGER_REMOVED',
    'QUALITY_WARNING',
    'COMPLETING',
    'COMPLETE',
    'FAILED',
    'CANCELLED',
  ] as const) {
    assert.ok(typeof PPG_COPY[s] === 'string' && PPG_COPY[s].length > 0, `copy for ${s}`);
  }
});

test('algorithm version ppg-1.1.0 is consistent across TS, Kotlin, Swift', () => {
  assert.equal(PPG_ALGORITHM_VERSION, 'ppg-1.1.0');
  const kt = src(KOTLIN_PROCESSOR);
  assert.ok(kt.includes('ALGORITHM_VERSION = "ppg-1.1.0"'), 'Kotlin version bump missing');
  const swift = src('modules/healthgraph-ppg/ios/HealthGraphPPGModule.swift');
  assert.ok(swift.includes('algorithmVersion = "ppg-1.1.0"'), 'Swift version bump missing');
});

test('reliability pipeline stages are mirrored in TS and Kotlin', () => {
  const tsMirror = src('modules/healthgraph-ppg/src/ppgSignal.ts');
  const kt = src(KOTLIN_PROCESSOR);
  for (const fn of [
    'detrend',
    'refinePeak',
    'sampleTimeAt',
    'displayHrFromRecent',
    'qualityComponents',
    'buildDebugSummary',
  ]) {
    assert.ok(tsMirror.includes(fn), `TS mirror missing ${fn}`);
    assert.ok(kt.includes(fn), `Kotlin missing ${fn}`);
  }
  // Median (not mean) HR in both pipelines.
  assert.ok(tsMirror.includes('60000 / median(rr)'), 'TS must use median HR');
  assert.ok(kt.includes('60000.0 / median(rr)'), 'Kotlin must use median HR');
  // Detrended peak detection threshold + dicrotic-safe refractory gap.
  assert.ok(kt.includes('0.5f * std'), 'Kotlin peak threshold must be 0.5σ');
  assert.ok(kt.includes('0.30f'), 'Kotlin refractory gap must be 0.30s');
  // Quality gate is unchanged at 0.5 (drift only discounts, never the gate).
  assert.ok(kt.includes('MIN_RELIABLE_QUALITY = 0.5f'), 'native threshold changed!');
});

test('real camera preview: Preview + analysis share one rear camera', () => {
  const kt = src(KOTLIN_MODULE);
  // Both use cases bound together to the same selector (one camera).
  assert.ok(kt.includes('Preview.Builder().build()'), 'Preview use case missing');
  assert.ok(
    kt.includes('bindToLifecycle(lifecycleOwner, selector, preview, analysis)'),
    'Preview + analysis must bind together to the same camera',
  );
  // Single back-camera selector; no second camera anywhere.
  assert.ok(kt.includes('CameraSelector.DEFAULT_BACK_CAMERA'), 'rear selector missing');
  // Lifecycle: preview published on bind, detached before unbind (no leak).
  assert.ok(kt.includes('PpgPreviewHost.publish(preview)'), 'preview publish missing');
  assert.ok(kt.includes('PpgPreviewHost.publish(null)'), 'preview detach on cleanup missing');
  // Native view registration + surface plumbing files exist.
  const view = src(KOTLIN_PREVIEW_VIEW);
  assert.ok(view.includes('class PpgCameraPreviewView'), 'preview view missing');
  assert.ok(view.includes('setSurfaceProvider'), 'surface provider wiring missing');
  assert.ok(view.includes('willNotProvideSurface'), 'surface decline path missing');
  const host = src(KOTLIN_PREVIEW_HOST);
  assert.ok(host.includes('object PpgPreviewHost'), 'preview host missing');
  assert.ok(kt.includes('View(PpgCameraPreviewView::class)'), 'view registration missing');
  // No frames cross the bridge: the view renders from the surface only.
  assert.ok(!view.includes('base64'), 'preview must never encode frames');
  assert.ok(!kt.includes('base64'), 'module must never encode frames');
  // JS preview component + screen surface.
  const tsx = src(PREVIEW_TSX);
  assert.ok(tsx.includes("requireNativeView('HealthGraphPPG')"), 'JS preview binding missing');
  const screen = src('src/screens/PpgMeasure/PpgMeasureScreen.tsx');
  assert.ok(screen.includes('PpgCameraPreview'), 'screen must mount the camera preview');
  // Monotonic camera timestamps (frame-rate variation cannot corrupt RR).
  assert.ok(kt.includes('imageInfo.timestamp'), 'camera timestamps missing');
});

test('debug summary crosses the bridge but never persists raw data', () => {
  const kt = src(KOTLIN_MODULE);
  assert.ok(kt.includes('"debugSummary"'), 'native never emits debugSummary');
  assert.ok(kt.includes('buildDebugSummary'), 'native never builds the summary');
  const bridge = src(BRIDGE);
  assert.ok(bridge.includes('debugSummary'), 'bridge does not forward debugSummary');
  const service = src(SERVICE);
  assert.ok(!service.includes('debugSummary'), 'debug telemetry must never persist');
});
