/**
 * rppgFlow — static flow-regression tests for the unified pulse instrument.
 *
 * One measurement path at a time (enforced by pulseMachineReducer):
 * - red-button tab lands on PulseInstrumentScreen (single entry)
 * - legacy PpgMeasureFlow / RppgMeasure routes are GONE (no dual paths)
 * - the instrument drives both hooks but mounts exactly one camera preview
 *   per authoritative mode (face XOR fingertip, never both)
 * - overlays are labeled visual-only (no face-detection claims)
 * - trace components render measured samples only (no sine synthesis)
 * - hooks/services/timeline/persistence contracts are unchanged
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
const INSTRUMENT = 'src/screens/PpgMeasure/PulseInstrumentScreen.tsx';
const MACHINE = 'src/services/pulse/pulseMachine.ts';
const RPPG_HOOK = 'src/hooks/useRppgMeasurement.ts';
const PPG_HOOK = 'src/hooks/usePpgMeasurement.ts';
const TABBAR = 'src/components/UmbrellaTabBar.tsx';
const TIMELINE = 'src/screens/Timeline/TimelineScreen.tsx';
const RPPG_PREVIEW = 'modules/healthgraph-rppg/src/RppgCameraPreview.tsx';

test('red-button tab lands on the unified pulse instrument', () => {
  const app = src(APP);
  // The tab renders the instrument. The liquid-glass redesign wraps the
  // screen in <LiquidTabFlow>, so accept either shape — what matters is
  // that the instrument is mounted for the PpgMeasure tab.
  const rendersInstrument =
    app.includes('<Tab.Screen name="PpgMeasure" component={PulseInstrumentScreen}') ||
    (app.includes('<Tab.Screen name="PpgMeasure"') &&
      app.includes('<PulseInstrumentScreen />'));
  assert.ok(rendersInstrument, 'PpgMeasure tab must render the instrument');
  const tab = src(TABBAR);
  assert.ok(tab.includes("'PpgMeasure'"), 'tab bar still targets PpgMeasure');
  assert.ok(tab.includes('Measure pulse'), 'accessibility label intact');
});

test('legacy dual routes are removed (no simultaneous paths)', () => {
  const app = src(APP);
  assert.ok(!app.includes('name="PpgMeasureFlow"'), 'fingertip stack route removed');
  assert.ok(!app.includes('name="RppgMeasure"'), 'face stack route removed');
  assert.ok(!app.includes('component={PpgMeasureScreen}'), 'legacy fingertip screen unmounted');
  assert.ok(!app.includes('component={RppgMeasureScreen}'), 'legacy face screen unmounted');
  assert.ok(!app.includes('component={PulseMethodScreen}'), 'legacy selector unmounted');
  const types = src(TYPES);
  assert.ok(!types.includes('PpgMeasureFlow: undefined'), 'flow param type removed');
  assert.ok(!types.includes('RppgMeasure: undefined'), 'face param type removed');
  for (const dead of [
    'src/screens/PpgMeasure/PpgMeasureScreen.tsx',
    'src/screens/PpgMeasure/RppgMeasureScreen.tsx',
    'src/screens/PpgMeasure/PulseMethodScreen.tsx',
  ]) {
    assert.ok(!fs.existsSync(path.join(ROOT, dead)), `${dead} deleted`);
  }
});

test('instrument owns single-mode orchestration', () => {
  const s = src(INSTRUMENT);
  assert.ok(s.includes('pulseMachineReducer'), 'reducer is the mode authority');
  assert.ok(s.includes('useRppgMeasurement'), 'drives the rPPG hook');
  assert.ok(s.includes('usePpgMeasurement'), 'drives the PPG hook');
  assert.ok(s.includes('RppgCameraPreview'), 'renders the face preview');
  assert.ok(s.includes('PpgCameraPreview'), 'renders the fingertip preview');
  // Exactly one preview mounts per authoritative mode.
  assert.ok(s.includes("machine.mode === 'face'"), 'face preview gated on face mode');
  assert.ok(s.includes("machine.mode === 'fingertip'"), 'fingertip preview gated on fingertip mode');
  assert.ok(s.includes('cancelRun'), 'single cancel path ends the active session');
  assert.ok(s.includes("'background'"), 'background cancel intact');
  assert.ok(s.includes('beforeRemove'), 'navigation-away cancel intact');
  assert.ok(s.includes('Not a medical device'), 'wellness disclaimer');
});

test('face overlay never claims detection', () => {
  const o = src('src/components/pulse/FaceGuideOverlay.tsx');
  assert.ok(o.includes('Not face detection'), 'honest accessibility label');
  // Positive detection claims only (the file names "detection" solely to
  // disclaim it — match claim shapes, not the word itself).
  assert.ok(!/face detection (is|using|technology|model)|landmark|mediapipe|detects (your|the) face|tracking (your|the) face/i.test(o), 'no detection claims');
  const screen = src(INSTRUMENT);
  assert.ok(screen.includes('Positioning guide only'), 'on-screen honesty caption');
});

test('fingertip overlay marks the sensing area only', () => {
  const o = src('src/components/pulse/FingertipGuideOverlay.tsx');
  assert.ok(!/fingertip (detection|segmentation|tracking)|segments (your|the) (finger|tip)/i.test(o), 'no segmentation/detection claims');
  const screen = src(INSTRUMENT);
  assert.ok(screen.includes('Placement guide only'), 'on-screen honesty caption');
});

test('trace views cannot synthesize data', () => {
  for (const f of [
    'src/components/pulse/PulseTraceView.tsx',
    'src/components/pulse/BpmTrendView.tsx',
  ]) {
    const s = src(f);
    assert.ok(!/Math\.sin|Math\.cos|buildSine|synthetic/i.test(s), `${f} has no waveform synthesis`);
    assert.ok(s.includes('NO SIGNAL') || s.includes('AWAITING SIGNAL'), `${f} renders absence as absence`);
  }
  const trace = src('src/components/pulse/PulseTraceView.tsx');
  assert.ok(trace.includes('detrendForDisplay'), 'renders provided samples only');
});

test('fingertip hook still refuses simulation persistence', () => {
  const h = src(PPG_HOOK);
  assert.ok(h.includes('saveAndSyncPpgResult'), 'unchanged save path');
  assert.ok(h.includes('r.simulated === true'), 'sim guard intact');
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
  // Waveform exposure is render-only: the persistence input must not grow a
  // waveform field (derived-only contract).
  const svc = src('src/services/rppgService.ts');
  assert.ok(!/waveform/i.test(svc), 'service never sees the render waveform');
});

test('fingertip raw trace cannot leak into storage or sync', () => {
  const repo = src('src/db/queries/ppg.ts');
  assert.ok(!/rawSignal/i.test(repo), 'SQLite layer has no rawSignal field');
  const svc = src('src/services/ppgService.ts');
  // The service may name rawSignal in comments that forbid it — the POST
  // payload itself must carry no raw field (match field shapes, not prose).
  assert.ok(!/rawSignal\s*:|exportRawSignal\s*:/.test(svc), 'sync payload has no raw field');
  assert.ok(svc.includes('no rawSignal'), 'prohibition documented');
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

test('pulse machine module carries the mode contract', () => {
  const m = src(MACHINE);
  assert.ok(m.includes('FACE_PROBE_DEADLINE_MS'), 'probe budget is explicit');
  assert.ok(m.includes('decideFaceViability'), 'viability is a pure decision');
  assert.ok(m.includes('CHOOSE_FINGERTIP'), 'explicit fallback transition');
  assert.ok(m.includes('most common cause is low light'), 'honest low-light copy');
});

test('unavailable provider surfaces the probe reason in user-visible detail', () => {
  const hook = src('src/hooks/useRppgMeasurement.ts');
  assert.ok(hook.includes('getOnnxRuntimeStatus'), 'probe status read on failure path');
  assert.ok(hook.includes('(code: '), 'reason code appended to detail');
});
