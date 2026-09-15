/**
 * rppgContract — static + provider contract tests for the on-device
 * PhysFormer rPPG inference layer.
 *
 * Covers (Increment 1 scope only):
 * - model metadata identity (PhysFormer, version, shapes, dtypes,
 *   BGR preprocessing, (pixel - 127.5) / 128 normalization)
 * - valid input acceptance ([1,3,160,128,128] float32 finite)
 * - invalid shape / dtype / NaN / Infinity rejection (never reshaped)
 * - output contract ([1,160] float32 finite, malformed rejected)
 * - unavailable-runtime behavior (explicit, never crashes, no fallback)
 * - inference plumbing through the ONNX provider with an injected stub
 *   session (the real onnxruntime-react-native needs a device build;
 *   the validated FP16 bytes themselves are verified with desktop
 *   ONNX Runtime separately)
 * - provider selection never crashing in runtimes without ONNX Runtime
 *
 * Does NOT test BPM, HRV, signal quality, camera, or UI (later increments).
 *
 * Imports are intentionally extensionless (Metro canonical form), so this
 * file runs via a throwaway transpile to /tmp (tests are excluded from the
 * project tsconfig). From `frontend/`:
 *   rm -rf /tmp/rppgstg /tmp/rppgout && mkdir -p /tmp/rppgstg && \
 *   cp --parents tests/rppgContract.test.mts \
 *     src/services/rppg/types.ts src/services/rppg/validation.ts \
 *     src/services/rppg/unavailableProvider.ts \
 *     src/services/rppg/onnxProvider.ts src/services/rppg/devValidate.ts \
 *     src/services/rppg/index.ts /tmp/rppgstg/ && \
 *   mv /tmp/rppgstg/tests/rppgContract.test.mts /tmp/rppgstg/tests/rppgContract.test.ts && \
 *   ./node_modules/.bin/tsc --ignoreConfig --ignoreDeprecations 6.0 \
 *     /tmp/rppgstg/tests/rppgContract.test.ts --rootDir /tmp/rppgstg \
 *     --outDir /tmp/rppgout --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck --noCheck --declaration false \
 *     --sourceMap false && \
 *   node --test /tmp/rppgout/tests/rppgContract.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RPPG_ARCHITECTURE,
  RPPG_CHANNEL_ORDER,
  RPPG_GRA_SHARP,
  RPPG_INPUT_DTYPE,
  RPPG_INPUT_ELEMENTS,
  RPPG_INPUT_SHAPE,
  RPPG_MODEL_ASSET,
  RPPG_MODEL_ID,
  RPPG_MODEL_LABEL,
  RPPG_MODEL_METADATA,
  RPPG_MODEL_VERSION,
  RPPG_NORMALIZE_MAX,
  RPPG_NORMALIZE_MEAN,
  RPPG_NORMALIZE_MIN,
  RPPG_NORMALIZE_SCALE,
  RPPG_OUTPUT_DTYPE,
  RPPG_OUTPUT_ELEMENTS,
  RPPG_OUTPUT_SHAPE,
  RPPG_PREPROCESSING_DOC,
} from '../src/services/rppg/types';
import {
  rppgNormalizePixel,
  validateRppgInput,
  validateRppgOutput,
} from '../src/services/rppg/validation';
import { createUnavailableRppgProvider } from '../src/services/rppg/unavailableProvider';
import {
  createOnnxRppgProvider,
  isOnnxRuntimeSupported,
} from '../src/services/rppg/onnxProvider';
import {
  __resetRppgProviderForTests,
  buildRppgSmokeTensor,
  getRppgProvider,
  runRppgDevValidation,
} from '../src/services/rppg/index';

// One shared valid tensor: validation never mutates its input.
const VALID = {
  data: (() => {
    const d = new Float32Array(RPPG_INPUT_ELEMENTS);
    d.fill(0.25);
    return d;
  })(),
  dims: [...RPPG_INPUT_SHAPE],
  dtype: 'float32' as const,
};

function withDims(dims: number[]) {
  return { data: new Float32Array(0), dims, dtype: 'float32' as const };
}

test('A. metadata identifies the validated PhysFormer FP16 model', () => {
  assert.equal(RPPG_ARCHITECTURE, 'PhysFormer');
  assert.equal(RPPG_MODEL_ID, 'physformer-rppg');
  assert.equal(RPPG_MODEL_VERSION, '1.0.0');
  assert.equal(RPPG_MODEL_LABEL, 'physformer-rppg-1.0.0');
  assert.equal(RPPG_MODEL_ASSET, 'physformer_rppg_fp16.onnx');
  assert.deepEqual([...RPPG_INPUT_SHAPE], [1, 3, 160, 128, 128]);
  assert.deepEqual([...RPPG_OUTPUT_SHAPE], [1, 160]);
  assert.equal(RPPG_INPUT_DTYPE, 'float32');
  assert.equal(RPPG_OUTPUT_DTYPE, 'float32');
  assert.equal(RPPG_CHANNEL_ORDER, 'BGR');
  assert.equal(RPPG_NORMALIZE_MEAN, 127.5);
  assert.equal(RPPG_NORMALIZE_SCALE, 128);
  assert.ok(RPPG_PREPROCESSING_DOC.includes('BGR'));
  assert.ok(RPPG_PREPROCESSING_DOC.includes('(pixel - 127.5) / 128'));
  assert.equal(RPPG_GRA_SHARP, 2.0);
  assert.deepEqual({ ...RPPG_MODEL_METADATA }.inputShape, [...RPPG_INPUT_SHAPE]);
  assert.equal(RPPG_MODEL_METADATA.onDeviceOnly, true);
});

test('A2. normalization helper matches (pixel - 127.5) / 128', () => {
  assert.equal(rppgNormalizePixel(0), RPPG_NORMALIZE_MIN);
  assert.equal(rppgNormalizePixel(255), RPPG_NORMALIZE_MAX);
  assert.equal(rppgNormalizePixel(127.5), 0);
  assert.equal(RPPG_NORMALIZE_MIN, -0.99609375);
  assert.equal(RPPG_NORMALIZE_MAX, 0.99609375);
});

test('B. valid input is accepted', () => {
  assert.doesNotThrow(() => validateRppgInput(VALID));
});

test('C. invalid shapes are rejected, never reshaped', () => {
  for (const dims of [
    [1, 3, 159, 128, 128],
    [1, 3, 160, 127, 128],
    [1, 3, 160, 128, 127],
    [3, 160, 128, 128],
  ]) {
    assert.throws(() => validateRppgInput(withDims(dims)), /exactly/);
  }
  assert.throws(() => validateRppgInput(null), /invalid inference input/);
  assert.throws(
    () => validateRppgInput({ ...VALID, data: new Float32Array(10) }),
    /length must be exactly/,
  );
});

test('D. invalid dtype is rejected', () => {
  assert.throws(
    () =>
      validateRppgInput({ data: VALID.data, dims: [...RPPG_INPUT_SHAPE], dtype: 'float64' }),
    /dtype must be exactly "float32"/,
  );
  assert.throws(
    () =>
      validateRppgInput({
        data: Array.from(VALID.data.slice(0, 8)),
        dims: [...RPPG_INPUT_SHAPE],
        dtype: 'float32',
      }),
    /must be a Float32Array/,
  );
});

test('E. NaN / Infinity are rejected', () => {
  const nan = { ...VALID, data: VALID.data.slice() };
  nan.data[12345] = Number.NaN;
  assert.throws(() => validateRppgInput(nan), /finite/);
  const inf = { ...VALID, data: VALID.data.slice() };
  inf.data[999] = Number.POSITIVE_INFINITY;
  assert.throws(() => validateRppgInput(inf), /finite/);
});

test('F. output contract is enforced', () => {
  const good = new Float32Array(RPPG_OUTPUT_ELEMENTS).fill(0.5);
  assert.doesNotThrow(() => validateRppgOutput(good, [1, 160]));
  assert.throws(() => validateRppgOutput(good, [1, 159]), /exactly \[1,160\]/);
  assert.throws(
    () => validateRppgOutput(Array(160).fill(0.1), [1, 160]),
    /must be .*Float32Array/,
  );
  const bad = new Float32Array(RPPG_OUTPUT_ELEMENTS).fill(0.1);
  bad[7] = Number.NaN;
  assert.throws(() => validateRppgOutput(bad, [1, 160]), /finite/);
});

test('G. unavailable runtime is explicit and never crashes', async () => {
  const p = createUnavailableRppgProvider('unit-test reason');
  assert.equal(p.kind, 'unavailable');
  assert.equal(p.isAvailable, false);
  assert.equal(p.getMetadata().modelLabel, 'physformer-rppg-1.0.0');
  await assert.rejects(() => p.infer(VALID), /inference unavailable/);
  const dev = await runRppgDevValidation(p, VALID);
  assert.equal(dev.success, false);
  assert.match(dev.reason ?? '', /unavailable/);
});

function stubBindings(waveform: number[], seen: { path?: string; feeds?: string[] }) {
  return {
    createSession: async (modelPath: string) => {
      seen.path = modelPath;
      return {
        run: async (feeds: Record<string, unknown>) => {
          seen.feeds = Object.keys(feeds);
          return {
            rppg: { data: Float32Array.from(waveform), dims: [1, 160] },
          };
        },
      };
    },
    createTensor: (data: Float32Array, dims: readonly number[]) => ({ data, dims: [...dims] }),
  };
}

function sineWaveform(): number[] {
  const out = new Array<number>(160);
  for (let i = 0; i < 160; i++) out[i] = Math.sin((i / 160) * Math.PI * 4) * 0.5;
  return out;
}

test('H. inference plumbing runs through the ONNX provider (stub runtime)', async () => {
  const seen: { path?: string; feeds?: string[] } = {};
  const provider = createOnnxRppgProvider({
    bindings: stubBindings(sineWaveform(), seen),
    resolveModelPath: async () => '/test/models/physformer_rppg_fp16.onnx',
  });
  assert.equal(provider.kind, 'onnx');
  assert.equal(provider.isAvailable, true);
  const out = await provider.infer(VALID);
  assert.deepEqual([...out.dims], [1, 160]);
  assert.ok(out.data instanceof Float32Array);
  assert.equal(out.data.length, 160);
  assert.ok([...out.data].every((v) => Number.isFinite(v)));
  assert.equal(seen.path, '/test/models/physformer_rppg_fp16.onnx');
  assert.deepEqual(seen.feeds, ['video']);
  const dev = await runRppgDevValidation(provider, VALID);
  assert.equal(dev.success, true);
  assert.equal(dev.modelVersion, '1.0.0');
  assert.deepEqual([...dev.inputShape], [1, 3, 160, 128, 128]);
  assert.deepEqual([...dev.outputShape], [1, 160]);
  assert.ok(typeof dev.inferenceMs === 'number');
});

test('H2. malformed model output fails loudly (stub runtime)', async () => {
  const provider = createOnnxRppgProvider({
    bindings: {
      createSession: async () => ({
        run: async () => ({
          rppg: { data: new Float32Array(159).fill(0.1), dims: [1, 159] },
        }),
      }),
      createTensor: (data: Float32Array, dims: readonly number[]) => ({ data, dims: [...dims] }),
    },
    resolveModelPath: async () => '/test/models/physformer_rppg_fp16.onnx',
  });
  await assert.rejects(() => provider.infer(VALID), /\[1,160\]/);
});

test('H3. forced-unavailable ONNX provider rejects without probing', async () => {
  const provider = createOnnxRppgProvider({ bindings: null });
  assert.equal(provider.isAvailable, false);
  await assert.rejects(() => provider.infer(VALID), /unavailable/);
});

test('I. model identity is exposed by every provider + selection never crashes', () => {
  for (const p of [
    createOnnxRppgProvider({ bindings: null }),
    createUnavailableRppgProvider('x'),
  ]) {
    assert.equal(p.getMetadata().modelLabel, 'physformer-rppg-1.0.0');
    assert.equal(p.getMetadata().architecture, 'PhysFormer');
  }
  __resetRppgProviderForTests();
  const first = getRppgProvider();
  const second = getRppgProvider();
  assert.equal(first, second);
  // node has no onnxruntime-react-native: must degrade to unavailable.
  assert.equal(isOnnxRuntimeSupported(), false);
  assert.equal(first.kind, 'unavailable');
  assert.equal(first.isAvailable, false);
  __resetRppgProviderForTests();
  assert.notEqual(getRppgProvider(), first);
  __resetRppgProviderForTests();
});

test('J. smoke tensor fixture honors the contract (not biometric data)', () => {
  const t = buildRppgSmokeTensor();
  assert.deepEqual([...t.dims], [1, 3, 160, 128, 128]);
  assert.equal(t.dtype, 'float32');
  assert.ok(t.data instanceof Float32Array);
  assert.equal(t.data.length, RPPG_INPUT_ELEMENTS);
  assert.doesNotThrow(() => validateRppgInput(t));
  const a = buildRppgSmokeTensor();
  const b = buildRppgSmokeTensor();
  assert.deepEqual([...a.data.slice(0, 16)], [...b.data.slice(0, 16)]);
});
