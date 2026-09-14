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
const BRIDGE = 'modules/healthgraph-ppg/src/HealthGraphPPGNative.ts';
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
  assert.deepEqual([...PPG_FAILURE_REASONS], ['NO_SAMPLES', 'LOW_QUALITY', 'NO_BEATS']);
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

test('simulated results are flagged and refused by persistence', () => {
  assert.equal(PPG_ALGORITHM_VERSION, 'ppg-1.0.0');
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
    'MEASURING',
    'QUALITY_WARNING',
    'COMPLETING',
    'COMPLETE',
    'FAILED',
    'CANCELLED',
  ] as const) {
    assert.ok(typeof PPG_COPY[s] === 'string' && PPG_COPY[s].length > 0, `copy for ${s}`);
  }
});
