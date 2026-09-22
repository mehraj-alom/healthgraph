/**
 * rppgFlow — static flow-regression tests for the Pulse method selector.
 *
 * Asserts the wiring that MUST stay intact without a device or build:
 * - red-button tab still lands on the Pulse method screen
 * - fingertip flow route serves the EXISTING untouched PpgMeasureScreen
 * - face flow route serves the new RppgMeasureScreen
 * - PpgMeasureScreen contains zero rPPG references (modality isolation)
 * - method + face screens honor the honesty rules (no fabricated BPM,
 *   no simulation fallback, wellness copy)
 * - route params + timeline carry source provenance for both methods
 *
 * Sources are read as TEXT (repo layout preserved in staging). From `frontend/`:
 *   rm -rf /tmp/rppgflow /tmp/rppgflow-out && mkdir -p /tmp/rppgflow && \
 *   cp --parents tests/rppgFlow.test.mts App.tsx src/types/index.ts \
 *     src/screens/PpgMeasure/PulseMethodScreen.tsx \
 *     src/screens/PpgMeasure/RppgMeasureScreen.tsx \
 *     src/screens/PpgMeasure/PpgMeasureScreen.tsx \
 *     src/hooks/useRppgMeasurement.ts src/hooks/usePpgMeasurement.ts \
 *     src/components/UmbrellaTabBar.tsx \
 *     src/screens/Timeline/TimelineScreen.tsx \
 *     modules/healthgraph-rppg/src/RppgCameraPreview.tsx /tmp/rppgflow/ && \
 *   mv /tmp/rppgflow/tests/rppgFlow.test.mts /tmp/rppgflow/tests/rppgFlow.test.ts && \
 *   ./node_modules/.bin/tsc --ignoreConfig --ignoreDeprecations 6.0 \
 *     /tmp/rppgflow/tests/rppgFlow.test.ts --rootDir /tmp/rppgflow \
 *     --outDir /tmp/rppgflow-out --module commonjs --target es2022 \
 *     --esModuleInterop --skipLibCheck --noCheck --declaration false \
 *     --sourceMap false && \
 *   node --test /tmp/rppgflow-out/tests/rppgFlow.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

const APP = 'App.tsx';
const TYPES = 'src/types/index.ts';
const METHOD = 'src/screens/PpgMeasure/PulseMethodScreen.tsx';
const RPPG_SCREEN = 'src/screens/PpgMeasure/RppgMeasureScreen.tsx';
const PPG_SCREEN = 'src/screens/PpgMeasure/PpgMeasureScreen.tsx';
const RPPG_HOOK = 'src/hooks/useRppgMeasurement.ts';
const PPG_HOOK = 'src/hooks/usePpgMeasurement.ts';
const TABBAR = 'src/components/UmbrellaTabBar.tsx';
const TIMELINE = 'src/screens/Timeline/TimelineScreen.tsx';
const RPPG_PREVIEW = 'modules/healthgraph-rppg/src/RppgCameraPreview.tsx';

test('red-button tab still lands on the Pulse method screen', () => {
  const app = src(APP);
  assert.ok(
    app.includes('<Tab.Screen name="PpgMeasure" component={PulseMethodScreen}'),
    'PpgMeasure tab must render the method selector',
  );
  const tab = src(TABBAR);
  assert.ok(tab.includes("'PpgMeasure'"), 'tab bar still targets PpgMeasure');
  assert.ok(tab.includes('Measure pulse'), 'accessibility label intact');
});

test('both flows are registered as stack routes with param types', () => {
  const app = src(APP);
  assert.ok(app.includes('name="PpgMeasureFlow"'), 'fingertip flow route');
  assert.ok(app.includes('component={PpgMeasureScreen}'), 'flow serves existing screen');
  assert.ok(app.includes('name="RppgMeasure"'), 'face flow route');
  assert.ok(app.includes('component={RppgMeasureScreen}'), 'face route serves new screen');
  const types = src(TYPES);
  assert.ok(types.includes('PpgMeasureFlow: undefined'), 'flow param type');
  assert.ok(types.includes('RppgMeasure: undefined'), 'face param type');
});

test('method screen offers both modalities with provenance badges', () => {
  const s = src(METHOD);
  assert.ok(s.includes("navigate('PpgMeasureFlow')"), 'fingertip navigation');
  assert.ok(s.includes("navigate('RppgMeasure')"), 'face navigation');
  assert.ok(s.includes('Fingertip PPG'), 'fingertip label');
  assert.ok(s.includes('Face rPPG'), 'face label');
  assert.ok(s.includes('getRecentPpgMeasurements'), 'fingertip recency');
  assert.ok(s.includes('getRecentRppgMeasurements'), 'face recency');
  assert.ok(s.includes('Not a medical device'), 'wellness disclaimer');
});

test('fingertip screen is untouched by rPPG (modality isolation)', () => {
  const s = src(PPG_SCREEN);
  assert.ok(!/rppg/i.test(s), 'PpgMeasureScreen must not reference rPPG');
  assert.ok(!s.includes('RppgMeasure'), 'no face-route reference');
  assert.ok(!s.includes('PulseMethodScreen'), 'no method-screen reference');
  assert.ok(s.includes('usePpgMeasurement'), 'still drives the PPG hook');
  assert.ok(s.includes('PpgCameraPreview'), 'still renders the PPG preview');
});

test('fingertip hook still refuses simulation persistence', () => {
  const h = src(PPG_HOOK);
  assert.ok(h.includes('saveAndSyncPpgResult'), 'unchanged save path');
  assert.ok(h.includes('r.simulated === true'), 'sim guard intact');
});

test('face screen honors the honesty rules', () => {
  const s = src(RPPG_SCREEN);
  assert.ok(s.includes('useRppgMeasurement'), 'drives the rPPG hook');
  assert.ok(s.includes('RppgCameraPreview'), 'renders the face preview');
  assert.ok(s.includes('hasResult'), 'HR gated on completion');
  assert.ok(s.includes('state === \'COMPLETE\''), 'no early BPM');
  assert.ok(s.includes('ErrorState'), 'failure surface');
  assert.ok(!/simulat/i.test(s), 'no simulation fallback');
  assert.ok(s.includes('never leave this phone'), 'privacy copy');
  assert.ok(s.includes('Not a medical device'), 'wellness disclaimer');
});

test('face preview never renders the native stub without the module', () => {
  // requireNativeView does NOT throw for a missing native module (Expo Go):
  // it returns a stub that warns "Unable to get the view config" on render.
  // The component must therefore gate rendering on isPreviewAvailable()
  // (backed by requireOptionalNativeModule, which IS null-safe).
  const p = src(RPPG_PREVIEW);
  assert.ok(p.includes('isPreviewAvailable'), 'availability gate exists');
  assert.ok(
    p.includes('if (!isPreviewAvailable() || !NativePreview)'),
    'stub renders only when the module is registered',
  );
});

test('face hook never persists unreliable runs, never invents HRV', () => {
  const h = src(RPPG_HOOK);
  assert.ok(h.includes('saveAndSyncRppgResult'), 'offline-first save');
  assert.ok(h.includes("quality.level === 'insufficient'"), 'insufficient gate');
  assert.ok(h.includes('hr.bpm === null'), 'null-HR gate');
  assert.ok(!/rmssd|sdnn|rrIntervals/i.test(h), 'no HRV fabrication in the hook');
  assert.ok(h.includes('syncPendingRppg'), 'pending retry on mount');
});

test('timeline distinguishes both pulse sources with provenance', () => {
  const t = src(TIMELINE);
  assert.ok(t.includes('Pulse — Fingertip'), 'fingertip title');
  assert.ok(t.includes('Pulse — Face scan'), 'face title');
  assert.ok(t.includes('getRecentPpgMeasurements'), 'fingertip history');
  assert.ok(t.includes('getRecentRppgMeasurements'), 'face history');
  assert.ok(t.includes('heart_rate_bpm == null'), 'null-HR rows skipped');
});

test('offline-first service: derived payload only, pending retry, no raw data', () => {
  const s = src('src/services/rppgService.ts');
  assert.ok(s.includes("measurementType: 'face_rppg'"), 'face provenance');
  assert.ok(s.includes('modelVersion: input.modelVersion'), 'model version sent');
  assert.ok(s.includes('samplingRateHz'), 'sampling rate sent');
  assert.ok(s.includes('rmssdMs: null'), 'HRV null by design (not invented)');
  // Leak vectors must never appear as sent fields (comments may name them
  // only to forbid them — match assignment/upload shapes, not prose).
  assert.ok(!/windowUri:|bgr:|base64|FormData|multipart/i.test(s), 'no raw data in service');
  assert.ok(s.includes("stays 'pending'"), 'offline rows stay pending');
  // Phase 4: independent rows continue past a single failure instead of
  // head-of-line blocking behind it (one poison row must not stall later
  // measurements; failed rows stay pending for the next trigger).
  assert.ok(s.includes('continue;'), 'retry continues past single failures');
  assert.ok(!s.includes('stop on first failure'), 'head-of-line break removed');
  assert.ok(s.includes('markRppgSynced'), 'synced marking');
  const q = src('src/db/queries/rppg.ts');
  assert.ok(q.includes('rppg_measurements'), 'separate modality table');
  assert.ok(!/(FROM|INTO|UPDATE)\s+ppg_measurements/.test(q), 'never touches the fingertip table');
  assert.ok(q.includes("sync_status"), 'offline pending flag');
});
