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
  mapNativeCaptureState,
  measuredFps,
  preprocessWindow,
  readRppgWindowFile,
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
  const [synced, setSynced] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const mounted = useRef(true);
  const settled = useRef(false);

  useEffect(() => {
    console.log('rppg stage: measure screen mounted');
    mounted.current = true;
    syncPendingRppg().catch(() => {});
    return () => {
      console.log('rppg stage: measure screen unmounted');
      mounted.current = false;
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
    setPermissionBlocked(false);
    settled.current = false;
    if (!mounted.current) return;

    if (!frameSource.isAvailable) {
      fail(
        'Face measurement is not available in this build. Please install the latest version of HealthGraph.',
      );
      return;
    }
    // Resolved here (not during render) so the ONNX native install never runs
    // in the React render phase. Log the stage so the exact point of any
    // future failure is identifiable in logcat.
    console.log('rppg stage: resolving on-device pulse provider');
    const provider = getRppgProvider();
    console.log('rppg stage: pulse provider resolved, available=' + provider.isAvailable);
    if (!provider.isAvailable) {
      fail(
        'The on-device pulse model is not available in this build. Please install the latest version of HealthGraph.',
      );
      return;
    }
    const permission = await ensureRppgCameraPermission();
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
      if (typeof e.framesCollected === 'number') setProgressFrames(e.framesCollected);
      const stability = typeof e.stability === 'number' ? e.stability : null;
      setLiveStability(stability);
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
      // unsupported capture rates, and non-monotonic timestamps).
      const window = await readRppgWindowFile(capture.windowUri);
      if (!mounted.current || settled.current) return;
      const { input, fpsMeasured } = preprocessWindow(window);

      console.log('rppg stage: running on-device model inference');
      const waveform = await provider.infer(input);
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
      await frameSource.cancel();
    } catch {
      // Cancel is best-effort.
    }
    if (!mounted.current) return;
    settled.current = true;
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
