/**
 * useRppgMeasurement — explicit-state face-rPPG measurement hook.
 *
 * Pipeline (all on-device): permission → front-camera capture (native
 * 160-frame window file) → window read + validate → BGR preprocess →
 * PhysFormer inference (RppgProvider) → spectral HR → quality gate →
 * offline-first persist of derived scalars only.
 *
 * Null-HR or insufficient-quality runs are shown but NEVER persisted or
 * synced. HRV is unavailable for the short capture window by design.
 *
 * Screen states: PREPARING → FIND_FACE → POSITION_FACE → ACQUIRING →
 * MEASURING → (SIGNAL_WEAK | FACE_LOST, capture continues) → COMPLETE |
 * FAILED. CANCELLED resets to IDLE.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RppgNativeEvent } from 'healthgraph-rppg';
import {
  RPPG_MODEL_METADATA,
  estimateRppgHeartRate,
  gateRppgQuality,
  getRppgFrameSource,
  getRppgProvider,
  isExpoGoRuntime,
  mapNativeCaptureState,
  measuredFps,
  preprocessWindowYielding,
  readRppgWindowFile,
  releaseRppgProvider,
  type RppgQualityLevel,
  type RppgScreenState,
} from '@/services/rppg';
import { ensureRppgCameraPermission } from '@/services/rppg/cameraPermission';
import { saveAndSyncRppgResult, syncPendingRppg } from '@/services/rppgService';

export type { RppgScreenState } from '@/services/rppg/faceTracker';

export interface RppgMeasurementResult {
  heartRateBpm: number | null;
  signalQuality: number;
  qualityLevel: RppgQualityLevel;
  durationSeconds: number;
  algorithmVersion: string;
  modelVersion: string;
  samplingRateHz: number;
  faceStability: number;
}

export interface UseRppgMeasurement {
  state: RppgScreenState;
  hint: string;
  result: RppgMeasurementResult | null;
  /** 0..160 capture progress (frames collected). */
  progressFrames: number;
  /** 0..1 live face stability for guidance. Null when unknown. */
  liveStability: number | null;
  /** 0..100 model download progress. Null when not downloading. */
  modelProgress: number | null;
  synced: boolean | null;
  error: string | null;
  permissionBlocked: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

/** Pipeline version for capture+HR+quality (model identity stays separate). */
export const RPPG_ALGORITHM_VERSION = 'rppg-1.0.0';

const HINTS: Record<RppgScreenState, string> = {
  IDLE: 'Measure your pulse with a short face scan.',
  PREPARING: 'Preparing the camera…',
  MODEL_DOWNLOAD: 'Downloading required model — 16.7 MB…',
  FIND_FACE: 'Show your face in the frame.',
  POSITION_FACE: 'Hold still, face centered in the guide.',
  ACQUIRING: 'Capturing… keep still.',
  MEASURING: 'Analyzing your pulse…',
  SIGNAL_WEAK: 'Signal looks weak — hold still and face the light.',
  FACE_LOST: 'Face lost. Center your face in the guide.',
  COMPLETING: 'Finishing measurement…',
  COMPLETE: 'Measurement complete.',
  FAILED: 'Measurement could not be completed. Try again.',
};

export function useRppgMeasurement(): UseRppgMeasurement {
  // NOTE: getRppgProvider() is intentionally NOT called during render. It
  // resolves the ONNX provider, which requires 'onnxruntime-react-native' —
  // and requiring that package runs Module.install(), a blocking synchronous
  // JSI native call. Running it in a render-phase useMemo crashed the app on
  // screen open. It is resolved lazily inside start() (an async event
  // handler) instead. getRppgFrameSource() is JS-only (no JSI install) and
  // safe to resolve here.
  const frameSource = useMemo(() => getRppgFrameSource(), []);
  const [state, setState] = useState<RppgScreenState>('IDLE');
  const [result, setResult] = useState<RppgMeasurementResult | null>(null);
  const [progressFrames, setProgressFrames] = useState(0);
  const [liveStability, setLiveStability] = useState<number | null>(null);
  const [modelProgress, setModelProgress] = useState<number | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const mounted = useRef(true);
  const settled = useRef(false);
  const modelAbortRef = useRef<AbortController | null>(null);
  // Throttle high-frequency capture telemetry into UI updates: the native
  // analyzer emits per-frame callbacks (tens/sec) but the progress bar and
  // stability label cannot meaningfully move that fast. State transitions
  // still dispatch per event; only the numeric progress/stability setters
  // are gated here. Sampling/inference correctness is untouched.
  const uiTelemetry = useRef({ frames: -1, stability: -1, at: 0 });

  useEffect(() => {
    console.log('rppg stage: measure screen mounted');
    mounted.current = true;
    syncPendingRppg().catch(() => {});
    return () => {
      console.log('rppg stage: measure screen unmounted');
      mounted.current = false;
      // Drop the cached ONNX session so native model resources can be
      // reclaimed when the flow is torn down. In-flight infer() calls hold
      // their own session reference; the next measurement re-initializes
      // lazily via getRppgProvider().
      releaseRppgProvider();
    };
  }, []);

  const fail = useCallback((message: string) => {
    if (!mounted.current || settled.current) return;
    settled.current = true;
    setError(message);
    setState('FAILED');
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setSynced(null);
    setProgressFrames(0);
    setLiveStability(null);
    setModelProgress(null);
    uiTelemetry.current = { frames: -1, stability: -1, at: 0 };
    setPermissionBlocked(false);
    settled.current = false;
    if (!mounted.current) return;

    if (!frameSource.isAvailable) {
      // Tell the user the REAL cause: Expo Go (or a build predating the
      // module) has no face-capture native code. "Latest version" misled
      // users who already had it — the runtime is what matters.
      fail(
        isExpoGoRuntime()
          ? 'Face measurement needs the HealthGraph app build — it cannot run inside Expo Go. Install the preview build and try again.'
          : 'Face measurement is missing from this build. Install the newest preview build of HealthGraph and try again.',
      );
      return;
    }
    // Resolved here (not during render) so the ONNX native install never runs
    // in the React render phase. Log the stage so the exact point of any
    // future failure is identifiable in logcat.
    console.log('rppg stage: resolving on-device pulse provider');
    const provider = getRppgProvider();
    // Internal diagnosis only (logcat): the user-facing copy below stays
    // the designed graceful unavailable message.
    console.log(
      'rppg stage: RPPG_PROVIDER_SELECT kind=' +
        provider.kind +
        ' available=' +
        provider.isAvailable,
    );
    if (!provider.isAvailable) {
      fail(
        isExpoGoRuntime()
          ? 'Face measurement needs the HealthGraph app build — it cannot run inside Expo Go. Install the preview build and try again.'
          : 'The on-device pulse model did not load in this build. Reinstall the newest preview build and try again.',
      );
      return;
    }

    // Model gate (on-demand asset): the provider only tells us whether the
    // RUNTIME can run inference. The 17 MB model itself downloads here, with
    // explicit progress, before the camera ever opens. Cached installs skip
    // instantly (works fully offline). Nothing about inference changes.
    setState('MODEL_DOWNLOAD');
    setModelProgress(0);
    modelAbortRef.current = new AbortController();
    let modelManager: typeof import('@/services/rppg/modelManager') | null = null;
    try {
      modelManager = await import('@/services/rppg/modelManager');
      await modelManager.ensureRppgModelAvailable(
        (p) => {
          if (mounted.current && !settled.current) setModelProgress(p.percent);
        },
        modelAbortRef.current.signal,
      );
    } catch (e: unknown) {
      modelAbortRef.current = null;
      if (!mounted.current || settled.current) return;
      const code =
        e instanceof Error && e.name === 'RppgModelError'
          ? (e as { code?: string }).code
          : undefined;
      if (code === 'cancelled') {
        settled.current = true;
        setModelProgress(null);
        setState('IDLE');
        return;
      }
      setModelProgress(null);
      fail(
        modelManager
          ? modelManager.friendlyRppgModelMessage(code)
          : 'The pulse model could not be prepared. Try again.',
      );
      return;
    }
    modelAbortRef.current = null;
    if (!mounted.current || settled.current) return;
    setModelProgress(null);
    const permission = await ensureRppgCameraPermission();
    console.log('rppg stage: RPPG_PERMISSION_CHECK result=' + permission);
    if (!mounted.current || settled.current) return;
    if (permission !== 'granted') {
      setPermissionBlocked(permission === 'blocked');
      fail(
        permission === 'blocked'
          ? 'Camera access is turned off for HealthGraph. Enable it in Settings to measure your pulse.'
          : 'Camera access is needed to measure your pulse. Your camera images never leave your phone.',
      );
      return;
    }

    setState('PREPARING');
    const off = frameSource.addListener((e) => {
      if (!mounted.current || settled.current) return;
      // UI throttle: progress moves in >=4-frame steps (or >=250 ms), and
      // stability only on meaningful (>=0.05) change or the same heartbeat.
      // Final values are still set explicitly on COMPLETE below.
      const nowMs = Date.now();
      const ui = uiTelemetry.current;
      if (typeof e.framesCollected === 'number') {
        if (
          e.framesCollected >= 160 ||
          e.framesCollected - ui.frames >= 4 ||
          nowMs - ui.at >= 250
        ) {
          ui.frames = e.framesCollected;
          ui.at = nowMs;
          setProgressFrames(e.framesCollected);
        }
      }
      const stability = typeof e.stability === 'number' ? e.stability : null;
      if (
        stability === null ||
        ui.stability < 0 ||
        Math.abs(stability - ui.stability) >= 0.05 ||
        nowMs - ui.at >= 250
      ) {
        ui.stability = stability ?? -1;
        setLiveStability(stability);
      }
      if (e.state === 'FAILED') {
        fail(e.message ?? 'Capture could not be completed. Try again.');
        return;
      }
      if (e.state === 'CANCELLED') return;
      setState((prev) =>
        prev === 'MEASURING' || prev === 'COMPLETING' || prev === 'COMPLETE'
          ? prev
          : mapNativeCaptureState(e.state, stability),
      );
    });

    try {
      console.log('rppg stage: starting native camera capture');
      const capture = await frameSource.capture({ timeoutSeconds: 30 });
      off();
      if (!mounted.current || settled.current) return;
      console.log('rppg stage: capture complete frames=' + capture.frameCount);
      setState('MEASURING');
      setProgressFrames(capture.frameCount);

      // Window file → validated tensor (refuses incomplete/corrupt windows,
      // unsupported capture rates, and non-monotonic timestamps). The
      // yielding variant produces a bit-identical tensor while letting the
      // JS event loop interleave between frame chunks (durations logged;
      // shapes/values only, never tensor contents).
      const window = await readRppgWindowFile(capture.windowUri);
      if (!mounted.current || settled.current) return;
      const preprocessStart = Date.now();
      const { input, fpsMeasured } = await preprocessWindowYielding(window);
      console.log(
        `rppg stage: RPPG_PREPROCESS_DONE ms=${Date.now() - preprocessStart} ` +
          `dims=${input.dims.join('x')}`,
      );

      console.log('rppg stage: running on-device model inference');
      const inferStart = Date.now();
      const waveform = await provider.infer(input);
      console.log(
        `rppg stage: RPPG_INFERENCE_DONE ms=${Date.now() - inferStart} ` +
          `dims=${waveform.dims.join('x')}`,
      );
      if (!mounted.current || settled.current) return;

      let variance = 0;
      let mean = 0;
      const data = waveform.data;
      for (let i = 0; i < data.length; i++) mean += data[i];
      mean /= data.length;
      for (let i = 0; i < data.length; i++) {
        const d = data[i] - mean;
        variance += d * d;
      }
      variance /= data.length;

      const hr = estimateRppgHeartRate(data, fpsMeasured);
      const droppedFrac =
        capture.frameCount > 0
          ? capture.droppedFrames / (capture.frameCount + capture.droppedFrames)
          : 1;
      const quality = gateRppgQuality({
        faceStableFrac: capture.faceStableFrac,
        droppedFrac,
        fpsMeasured,
        waveformVariance: variance,
        hr,
      });
      if (!mounted.current || settled.current) return;

      if (hr.bpm === null || quality.level === 'insufficient') {
        const reason =
          hr.reason === 'FLAT'
            ? 'No pulse signal was found. Face the light, hold still, and try again.'
            : hr.reason === 'UNSTABLE_SEGMENTS'
              ? 'Your pulse reading was too unstable to trust. Hold still and try again.'
              : 'Signal quality too low for a reliable reading. Hold still and try again.';
        fail(reason);
        return;
      }

      const durationSeconds = Math.max(
        1,
        Math.round(capture.durationMs / 1000),
      );
      const measured: RppgMeasurementResult = {
        heartRateBpm: Math.round(hr.bpm),
        signalQuality: Math.round(quality.score * 100) / 100,
        qualityLevel: quality.level,
        durationSeconds,
        algorithmVersion: RPPG_ALGORITHM_VERSION,
        modelVersion: RPPG_MODEL_METADATA.modelLabel,
        samplingRateHz: Math.round(fpsMeasured * 10) / 10,
        faceStability: Math.round(capture.faceStableFrac * 100) / 100,
      };
      setResult(measured);
      try {
        const out = await saveAndSyncRppgResult({
          heartRateBpm: measured.heartRateBpm,
          signalQuality: measured.signalQuality,
          durationSeconds: measured.durationSeconds,
          algorithmVersion: measured.algorithmVersion,
          modelVersion: measured.modelVersion,
          samplingRateHz: measured.samplingRateHz,
          faceStability: measured.faceStability,
          measuredAt: new Date().toISOString(),
        });
        if (!mounted.current || settled.current) return;
        settled.current = true;
        setSynced(out.syncedToServer);
        setState('COMPLETE');
      } catch (e: any) {
        if (!mounted.current || settled.current) return;
        settled.current = true;
        setError(e?.message ?? 'Measurement could not be saved. Try again.');
        setState('FAILED');
      }
    } catch (e: any) {
      off();
      if (!mounted.current || settled.current) return;
      const cancelled =
        e?.code === 'CANCELLED' || /cancel/i.test(String(e?.message ?? ''));
      if (cancelled) {
        settled.current = true;
        setState('IDLE');
        return;
      }
      const code = e?.code as string | undefined;
      if (code === 'INSUFFICIENT_FRAMES') {
        fail('Not enough steady face frames were captured. Hold still in good light and try again.');
      } else if (code === 'CAMERA_PERMISSION' || code === 'CAMERA_START' || code === 'NO_CAMERA') {
        fail('The camera could not be started. Restart the app and try again.');
      } else if (e?.code === 'INVALID_RPPG_INPUT' || e?.code === 'RPPG_INFERENCE_FAILED' || e?.code === 'INVALID_RPPG_WINDOW') {
        fail('The capture could not be analyzed on this device. Try again in good light.');
      } else {
        fail(e?.message ?? 'Measurement could not be completed. Try again.');
      }
    }
  }, [frameSource, fail]);

  const cancel = useCallback(async () => {
    try {
      modelAbortRef.current?.abort();
    } catch {
      // Abort is best-effort.
    }
    modelAbortRef.current = null;
    try {
      await frameSource.cancel();
    } catch {
      // Cancel is best-effort.
    }
    if (!mounted.current) return;
    settled.current = true;
    setModelProgress(null);
    setState('IDLE');
    setProgressFrames(0);
    setLiveStability(null);
  }, [frameSource]);

  const reset = useCallback(() => {
    settled.current = false;
    setState('IDLE');
    setResult(null);
    setProgressFrames(0);
    setLiveStability(null);
    setModelProgress(null);
    setSynced(null);
    setError(null);
    setPermissionBlocked(false);
  }, []);

  return {
    state,
    hint: HINTS[state],
    result,
    progressFrames,
    liveStability,
    modelProgress,
    synced,
    error,
    permissionBlocked,
    start,
    cancel,
    reset,
  };
}

/** Test seam: pure mapping of native capture states to screen states. */
export function mapRppgNativeStateForTests(
  native: RppgNativeEvent['state'],
  stability: number | null,
): RppgScreenState {
  return mapNativeCaptureState(native, stability);
}

/** Test seam: fps helper re-export for contract tests. */
export { measuredFps };
