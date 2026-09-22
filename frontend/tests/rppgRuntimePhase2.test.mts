/**
 * rppgRuntimePhase2 — behavioral regression tests for the RPPG runtime
 * hardening (Phase 2). Pure node, no RN, no device, no new deps:
 *   node --experimental-strip-types --test frontend/tests/rppgRuntimePhase2.test.mts
 *
 * Covers the REAL pure units behind the measurement lifecycle:
 *   - screen state taxonomy (busy/rest/startable — single source of truth)
 *   - native→screen mapping for every event incl. CANCELLED→IDLE
 *   - FaceTracker guidance progression on deterministic fixtures
 *   - HR estimator accept/reject semantics on synthetic waveforms
 *   - quality-gate boundaries (reliable vs borderline vs insufficient) and
 *     the persistence rule (insufficient/null-HR never persistable)
 *   - unique temp-download naming (concurrent-download race fix)
 *   - failure-copy mapping incl. timeout/cancelled routing
 * plus wiring guards proving the hook/screen/manager/native actually USE
 * these contracts (sources read as text, exactly like rppgFlow.test.mts).
 *
 * These tests do NOT execute native ONNX Runtime code and prove nothing
 * about on-device inference — only the deterministic layers around it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  FaceTracker,
  buildTelemetryFixture,
  canStartRppgFrom,
  isRppgBusyState,
  isRppgRestState,
  mapNativeCaptureState,
  RPPG_BUSY_STATES,
  RPPG_REST_STATES,
  type RppgScreenState,
} from '../src/services/rppg/faceTracker.ts';
import {
  gateRppgQuality,
  rppgReliableForPersistence,
  type RppgQualityInput,
} from '../src/services/rppg/qualityGate.ts';
import {
  buildSineWaveform,
  estimateRppgHeartRate,
} from '../src/services/rppg/hrEstimator.ts';
import {
  friendlyRppgModelMessage,
  tempDownloadName,
  RPPG_DOWNLOAD_SUFFIX,
} from '../src/services/rppg/modelMeta.ts';

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
      if (fs.existsSync(path.join(b, 'App.tsx'))) return b;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('repo root not found (App.tsx missing)');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const ALL_STATES: RppgScreenState[] = [
  'IDLE',
  'PREPARING',
  'MODEL_DOWNLOAD',
  'FIND_FACE',
  'POSITION_FACE',
  'ACQUIRING',
  'MEASURING',
  'SIGNAL_WEAK',
  'FACE_LOST',
  'COMPLETING',
  'COMPLETE',
  'FAILED',
];

// ============================================================================
// State taxonomy — busy/rest/startable are total and disjoint
// ============================================================================

describe('screen state taxonomy', () => {
  test('every state is exactly busy or resting, never both, never neither', () => {
    for (const s of ALL_STATES) {
      const busy = isRppgBusyState(s);
      const rest = isRppgRestState(s);
      assert.ok(busy !== rest, `${s}: busy=${busy} rest=${rest}`);
    }
    assert.equal(RPPG_BUSY_STATES.length + RPPG_REST_STATES.length, ALL_STATES.length);
    assert.equal(new Set([...RPPG_BUSY_STATES, ...RPPG_REST_STATES]).size, ALL_STATES.length);
  });

  test('busy covers the full run (permission→camera→capture→processing)', () => {
    for (const s of [
      'PREPARING',
      'MODEL_DOWNLOAD',
      'FIND_FACE',
      'POSITION_FACE',
      'ACQUIRING',
      'MEASURING',
      'SIGNAL_WEAK',
      'FACE_LOST',
      'COMPLETING',
    ] as RppgScreenState[]) {
      assert.equal(isRppgBusyState(s), true, s);
    }
    assert.equal(isRppgBusyState('IDLE'), false);
    assert.equal(isRppgBusyState('COMPLETE'), false);
    assert.equal(isRppgBusyState('FAILED'), false);
  });

  test('restart rules: IDLE/FAILED may start, COMPLETE requires reset', () => {
    assert.equal(canStartRppgFrom('IDLE'), true);
    assert.equal(canStartRppgFrom('FAILED'), true);
    for (const s of ALL_STATES) {
      if (s === 'IDLE' || s === 'FAILED') continue;
      assert.equal(canStartRppgFrom(s), false, s);
    }
  });
});

// ============================================================================
// Native→screen mapping — every event incl. terminal/cancel legs
// ============================================================================

describe('mapNativeCaptureState', () => {
  const cases: Array<[Parameters<typeof mapNativeCaptureState>[0], RppgScreenState]> = [
    ['STARTING', 'PREPARING'],
    ['FIND_FACE', 'FIND_FACE'],
    ['POSITION_FACE', 'POSITION_FACE'],
    ['ACQUIRING', 'ACQUIRING'],
    ['FACE_LOST', 'FACE_LOST'],
    ['COMPLETING', 'COMPLETING'],
    ['COMPLETE', 'COMPLETING'],
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'IDLE'],
  ];

  for (const [native, expected] of cases) {
    test(`${native} → ${expected}`, () => {
      assert.equal(mapNativeCaptureState(native, 0.9), expected);
    });
  }

  test('weak live stability surfaces guidance without aborting capture', () => {
    assert.equal(mapNativeCaptureState('ACQUIRING', 0.2), 'SIGNAL_WEAK');
    assert.equal(mapNativeCaptureState('ACQUIRING', 0.39), 'SIGNAL_WEAK');
    assert.equal(mapNativeCaptureState('ACQUIRING', 0.4), 'ACQUIRING');
    assert.equal(mapNativeCaptureState('ACQUIRING', null), 'ACQUIRING');
  });
});

// ============================================================================
// FaceTracker guidance on deterministic fixtures
// ============================================================================

describe('FaceTracker', () => {
  test('stable presence warms up FIND → POSITION → ACQUIRING', () => {
    const t = new FaceTracker();
    const samples = buildTelemetryFixture(30, 'stable');
    let last = t.observe(samples[0]);
    assert.equal(last.state, 'FIND_FACE');
    for (const s of samples.slice(1)) last = t.observe(s);
    assert.equal(last.state, 'ACQUIRING');
    assert.ok(last.stableFrac > 0.9);
  });

  test('sustained absence ends in FACE_LOST, never ACQUIRING', () => {
    const t = new FaceTracker();
    let last = t.observe(buildTelemetryFixture(1, 'absent')[0]);
    for (const s of buildTelemetryFixture(60, 'absent')) last = t.observe(s);
    assert.equal(last.state, 'FACE_LOST');
  });

  test('non-finite samples never crash and never count as present', () => {
    const t = new FaceTracker();
    const snap = t.observe({
      brightness: Number.NaN,
      skinRatio: 0.9,
      motion: 0,
      timestampMs: 0,
    });
    assert.equal(snap.stability, 0);
    assert.ok(snap.state === 'FIND_FACE' || snap.state === 'POSITION_FACE');
  });

  test('reset returns to the initial guidance state', () => {
    const t = new FaceTracker();
    for (const s of buildTelemetryFixture(30, 'stable')) t.observe(s);
    t.reset();
    const snap = t.observe(buildTelemetryFixture(1, 'stable')[0]);
    assert.equal(snap.samples, 1);
    assert.equal(snap.state, 'FIND_FACE');
  });
});

// ============================================================================
// HR estimator — real values accepted, invalid refused (never invented)
// ============================================================================

describe('estimateRppgHeartRate', () => {
  test('clean 72 bpm sine resolves near 72', () => {
    const wave = buildSineWaveform(72, 30, 160);
    const est = estimateRppgHeartRate(wave, 30);
    assert.ok(est.bpm !== null, `rejected: ${est.reason}`);
    assert.ok(Math.abs((est.bpm as number) - 72) < 5, `bpm=${est.bpm}`);
    assert.equal(est.reason, null);
  });

  test('flat line is refused as FLAT (never a number)', () => {
    const est = estimateRppgHeartRate(new Float32Array(160).fill(0.5), 30);
    assert.equal(est.bpm, null);
    assert.equal(est.reason, 'FLAT');
  });

  test('empty input is refused as EMPTY', () => {
    const est = estimateRppgHeartRate(new Float32Array(0), 30);
    assert.equal(est.bpm, null);
    assert.equal(est.reason, 'EMPTY');
  });

  test('NaN anywhere is refused as NON_FINITE', () => {
    const wave = buildSineWaveform(80, 30, 160);
    wave[77] = Number.NaN;
    const est = estimateRppgHeartRate(wave, 30);
    assert.equal(est.bpm, null);
    assert.equal(est.reason, 'NON_FINITE');
  });

  test('wildly unstable segments are refused, not averaged', () => {
    // Two halves at distant rates: full-window peak cannot represent both.
    const first = buildSineWaveform(60, 30, 80);
    const second = buildSineWaveform(150, 30, 80);
    const wave = new Float32Array(160);
    wave.set(first, 0);
    wave.set(second, 80);
    const est = estimateRppgHeartRate(wave, 30);
    assert.equal(est.bpm, null);
    assert.ok(
      est.reason === 'UNSTABLE_SEGMENTS' || est.reason === 'EDGE_PEAK',
      `reason=${est.reason}`,
    );
  });
});

// ============================================================================
// Quality gate — boundaries preserve validation semantics
// ============================================================================

function qualityInput(overrides: Partial<RppgQualityInput> = {}): RppgQualityInput {
  return {
    faceStableFrac: 0.9,
    droppedFrac: 0.05,
    fpsMeasured: 30,
    waveformVariance: 0.01,
    hr: { bpm: 72, concentration: 0.5, segmentSpreadBpm: 2, peakHz: 1.2, reason: null },
    ...overrides,
  };
}

describe('gateRppgQuality', () => {
  test('clean run is reliable', () => {
    const r = gateRppgQuality(qualityInput());
    assert.equal(r.level, 'reliable');
  });

  test('degraded stability is borderline — explicitly not reliable', () => {
    const r = gateRppgQuality(
      qualityInput({ faceStableFrac: 0.6, droppedFrac: 0.1, hr: { bpm: 72, concentration: 0.25, segmentSpreadBpm: 3, peakHz: 1.2, reason: null } }),
    );
    assert.equal(r.level, 'borderline');
  });

  test('null HR is insufficient (never produces a result)', () => {
    const r = gateRppgQuality(
      qualityInput({ hr: { bpm: null, concentration: 0, segmentSpreadBpm: 0, peakHz: null, reason: 'FLAT' } }),
    );
    assert.equal(r.level, 'insufficient');
  });

  test('flat waveform is insufficient even with a claimed HR', () => {
    const r = gateRppgQuality(qualityInput({ waveformVariance: 0 }));
    assert.equal(r.level, 'insufficient');
  });

  test('heavy frame loss can never be reliable (flagged at most borderline)', () => {
    const r = gateRppgQuality(qualityInput({ droppedFrac: 0.5 }));
    assert.notEqual(r.level, 'reliable');
    assert.ok(r.reasons.includes('frame-loss'));
  });

  test('fps drift outside tolerance can never be reliable', () => {
    const r = gateRppgQuality(qualityInput({ fpsMeasured: 20 }));
    assert.notEqual(r.level, 'reliable');
    assert.ok(r.reasons.includes('fps-drift'));
  });

  test('persistence rule: HR + quality + duration, nothing else', () => {
    assert.equal(rppgReliableForPersistence(72, 0.8, 6), true);
    assert.equal(rppgReliableForPersistence(null, 0.8, 6), false);
    assert.equal(rppgReliableForPersistence(72, 0.49, 6), false);
    assert.equal(rppgReliableForPersistence(72, 0.8, 4), false);
  });
});

// ============================================================================
// Unique temp-download naming (concurrent-ensure race fix)
// ============================================================================

describe('tempDownloadName', () => {
  test('unique per nonce, basename preserved, suffixed', () => {
    const a = tempDownloadName('physformer_rppg_fp16.onnx', 'abc123');
    const b = tempDownloadName('physformer_rppg_fp16.onnx', 'zzz999');
    assert.ok(a.startsWith('physformer_rppg_fp16.onnx' + RPPG_DOWNLOAD_SUFFIX));
    assert.notEqual(a, b);
  });

  test('strips directories (no path traversal)', () => {
    const n = tempDownloadName('../../etc/passwd', 'q');
    assert.ok(!n.includes('/'));
    assert.ok(!n.includes('..'));
  });

  test('sanitizes hostile characters', () => {
    const n = tempDownloadName('a b;c$d.onnx', 'n!o@n#e');
    assert.match(n, /^[A-Za-z0-9._-]+$/);
  });
});

// ============================================================================
// Failure copy — timeout/cancel route distinctly from generic failure
// ============================================================================

describe('friendlyRppgModelMessage', () => {
  test('network/checksum/storage each map distinctly', () => {
    const msgs = ['network', 'checksum', 'storage'].map((c) =>
      friendlyRppgModelMessage(c),
    );
    assert.equal(new Set(msgs).size, 3);
  });

  test('cancelled/undefined fall back to generic (hook handles cancel silently)', () => {
    assert.equal(
      friendlyRppgModelMessage('cancelled'),
      friendlyRppgModelMessage(undefined),
    );
  });
});

// ============================================================================
// Wiring guards — the runtime actually uses these contracts
// ============================================================================

describe('phase 2 wiring', () => {
  test('hook gates start state, watchdogs the download, uses the manager race fix', () => {
    const hook = src('src/hooks/useRppgMeasurement.ts');
    assert.ok(hook.includes('canStartRppgFrom'));
    assert.ok(hook.includes('RPPG_MODEL_DOWNLOAD_TIMEOUT_MS'));
    assert.ok(hook.includes('downloadTimedOut'));
  });

  test('screen derives busy from the single source of truth', () => {
    const screen = src('src/screens/PpgMeasure/RppgMeasureScreen.tsx');
    assert.ok(screen.includes('isRppgBusyState'));
    // The old duplicated literal list must be gone.
    assert.ok(!screen.includes("'MODEL_DOWNLOAD',"));
  });

  test('manager uses unique temp paths and codes storage failures', () => {
    const manager = src('src/services/rppg/modelManager.ts');
    assert.ok(manager.includes('attemptTempFile'));
    assert.ok(manager.includes('tempDownloadName'));
    assert.ok(manager.includes('sweepStaleTempFiles'));
    assert.ok(manager.includes("'storage'"));
  });

  test('native modules settle the pending start on cancel', () => {
    const kt = src('modules/healthgraph-rppg/android/src/main/java/com/healthgraph/rppg/HealthGraphRPPGModule.kt');
    const swift = src('modules/healthgraph-rppg/ios/HealthGraphRPPGModule.swift');
    assert.ok(kt.includes('pendingPromise'));
    assert.ok(swift.includes('pendingPromise'));
  });

  test('native failures invalidate the run generation (no late bind)', () => {
    const kt = src('modules/healthgraph-rppg/android/src/main/java/com/healthgraph/rppg/HealthGraphRPPGModule.kt');
    const swift = src('modules/healthgraph-rppg/ios/HealthGraphRPPGModule.swift');
    // failRun bumps the generation so late provider/session callbacks bind nothing.
    assert.ok(kt.includes('runId.incrementAndGet()'));
    assert.ok(swift.includes('runId += 1'));
  });

  test('iOS FAILED events carry the message (Android parity)', () => {
    const swift = src('modules/healthgraph-rppg/ios/HealthGraphRPPGModule.swift');
    assert.ok(swift.includes('"message": message'));
  });
});
