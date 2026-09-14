/**
 * PPG provider tests (Expo-Go-safe path).
 *
 * Exercise the SIMULATED provider only — it is dependency-free (pure signal
 * code) and therefore import-safe in node. The native provider is validated
 * by `tsc`, Gradle compilation, and on-device runs, not here.
 *
 * Imports are intentionally extensionless (Metro canonical form), so this
 * file runs via a throwaway transpile to /tmp (tests are excluded from the
 * project tsconfig). From `frontend/`:
 *   rm -rf /tmp/ppgstg /tmp/ppgprov && mkdir -p /tmp/ppgstg && \
 *   cp --parents tests/ppgProviders.test.mts src/services/ppg/simulatedProvider.ts \
 *     src/services/ppg/types.ts modules/healthgraph-ppg/src/ppgSignal.ts \
 *     modules/healthgraph-ppg/src/HealthGraphPPG.types.ts /tmp/ppgstg/ && \
 *   mv /tmp/ppgstg/tests/ppgProviders.test.mts /tmp/ppgstg/tests/ppgProviders.test.ts && \
 *   ./node_modules/.bin/tsc --ignoreConfig --ignoreDeprecations 6.0 \
 *     /tmp/ppgstg/tests/ppgProviders.test.ts --rootDir /tmp/ppgstg \
 *     --outDir /tmp/ppgprov --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck --noCheck --declaration false \
 *     --sourceMap false && \
 *   node --test /tmp/ppgprov/tests/ppgProviders.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIM_ALGORITHM_VERSION,
  simulatedPpgProvider,
  syntheticPulseSeries,
} from '../src/services/ppg/simulatedProvider';
import type { PpgState } from '../src/services/ppg/types';

test('simulated provider is marked and available everywhere', () => {
  assert.equal(simulatedPpgProvider.kind, 'simulated');
  assert.equal(simulatedPpgProvider.isAvailable, true);
});

test('synthetic series is deterministic', () => {
  const a = syntheticPulseSeries(72, 15);
  const b = syntheticPulseSeries(72, 15);
  assert.deepEqual(a.samples, b.samples);
  assert.deepEqual(a.timestampsMs, b.timestampsMs);
  assert.equal(a.samples.length, 15 * 30);
});

test('simulated measurement resolves flagged result with full state sequence', async () => {
  const seen: PpgState[] = [];
  const off = simulatedPpgProvider.addStateListener((e) => {
    seen.push(e.state);
  });
  try {
    const result = await simulatedPpgProvider.measure({ durationSeconds: 15 });
    assert.equal(result.simulated, true);
    assert.equal(result.algorithmVersion, SIM_ALGORITHM_VERSION);
    assert.equal(result.durationSeconds, 15);
    assert.ok(
      result.heartRateBpm != null && Math.abs(result.heartRateBpm - 72) <= 8,
      `sim hr=${result.heartRateBpm}`,
    );
    assert.ok(result.signalQuality >= 0.5, `sim q=${result.signalQuality}`);
    for (const s of ['STARTING', 'ACQUIRING', 'MEASURING', 'COMPLETING', 'COMPLETE'] as const) {
      assert.ok(seen.includes(s), `missing state ${s} in [${seen.join(',')}]`);
    }
  } finally {
    off();
  }
});

test('simulated live BPM is numeric on measuring events', async () => {
  const live: Array<number | null | undefined> = [];
  const off = simulatedPpgProvider.addStateListener((e) => {
    if (e.state === 'MEASURING') live.push(e.liveBpm);
  });
  try {
    await simulatedPpgProvider.measure({ durationSeconds: 10 });
    assert.ok(live.length > 0, 'expected MEASURING events');
    for (const bpm of live) {
      assert.ok(typeof bpm === 'number', `liveBpm must be numeric, got ${bpm}`);
    }
  } finally {
    off();
  }
});

test('simulated measurement clamps duration into the native 10–300s window', async () => {
  const short = await simulatedPpgProvider.measure({ durationSeconds: 2 });
  assert.equal(short.durationSeconds, 10);
  assert.equal(short.simulated, true);
});

test('simulated cancel rejects with CANCELLED and emits CANCELLED', async () => {
  const seen: PpgState[] = [];
  const off = simulatedPpgProvider.addStateListener((e) => {
    seen.push(e.state);
  });
  try {
    const pending = simulatedPpgProvider.measure({ durationSeconds: 60 });
    await simulatedPpgProvider.cancel();
    await assert.rejects(pending, /cancel/i);
    assert.ok(seen.includes('CANCELLED'));
  } finally {
    off();
  }
});
