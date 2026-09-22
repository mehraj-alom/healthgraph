/**
 * usePpgMeasurement — explicit-state PPG measurement hook.
 *
 * Consumes the PPG provider boundary (`@/services/ppg`), never the native
 * module directly. In custom dev/production builds this drives the real
 * on-device camera module; in Expo Go / web it drives the clearly-marked
 * simulation (results are NOT persisted or synced).
 *
 * States: IDLE → STARTING → WAITING_FOR_FINGER → ACQUIRING → MEASURING →
 * (SIGNAL_WEAK | FINGER_REMOVED, with automatic reacquisition) → COMPLETING →
 * COMPLETE | FAILED | CANCELLED. The UI must surface weak-signal guidance
 * and never present unreliable results as reliable (heartRateBpm is null
 * when quality gates fail).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getPpgProvider,
  isExpoGoPpgRuntime,
  PPG_COPY,
  type PpgMeasurementResult,
  type PpgState,
} from '@/services/ppg';
import { saveAndSyncPpgResult, syncPendingPpg } from '@/services/ppgService';
import { ensureCameraPermission } from '@/services/ppg/cameraPermission';

export interface UsePpgMeasurement {
  state: PpgState;
  hint: string;
  result: PpgMeasurementResult | null;
  liveQuality: number | null;
  /**
   * Confident live BPM during a native session, updated ~1Hz. Null means NO
   * trustworthy live value (waiting/acquiring/weak/removed) — the UI must
   * render no BPM rather than a stale number.
   */
  liveBpm: number | null;
  /** True when running the Expo Go / web simulation (not a real measurement). */
  simulated: boolean;
  synced: boolean | null;
  error: string | null;
  /** True when the OS will no longer prompt (enable in Settings instead). */
  permissionBlocked: boolean;
  start: (durationSeconds?: number) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function usePpgMeasurement(): UsePpgMeasurement {
  const provider = useMemo(() => getPpgProvider(), []);
  const [state, setState] = useState<PpgState>('IDLE');
  const [result, setResult] = useState<PpgMeasurementResult | null>(null);
  const [liveQuality, setLiveQuality] = useState<number | null>(null);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const mounted = useRef(true);
  // Re-entrancy guard: a second Start press while a measurement is in flight
  // must be a no-op — otherwise two concurrent runs each insert their own
  // local row (and POST twice, which the server cannot dedupe). Mirrors the
  // rPPG hook's startInFlightRef. Cleared on every exit via finally below.
  const startInFlightRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const off = provider.addStateListener((e) => {
      if (!mounted.current) return;
      setState(e.state);
      if (typeof e.signalQuality === 'number') setLiveQuality(e.signalQuality);
      // No signal means no quality either: finger waiting/removed clears any
      // stale band so the UI never shows a leftover "good signal".
      if (e.state === 'WAITING_FOR_FINGER' || e.state === 'FINGER_REMOVED') {
        setLiveQuality(null);
      }
      // Live BPM is only ever set from a numeric event value; every other
      // session event clears it so a stale number can never linger on screen
      // (finger removed, weak signal, completion, failure, cancel).
      if (typeof e.liveBpm === 'number') setLiveBpm(e.liveBpm);
      else setLiveBpm(null);
      if (e.state === 'FAILED') setError(e.message ?? 'Measurement could not be completed. Try again.');
    });
    // Flush any backlog left by an earlier offline session (real only;
    // the service refuses simulated input, so this is a no-op for sim).
    syncPendingPpg().catch(() => {});
    return () => {
      mounted.current = false;
      off();
    };
  }, [provider]);

  const start = useCallback(async (durationSeconds = 60) => {
    setError(null);
    setResult(null);
    setLiveBpm(null);
    setSynced(null);
    setPermissionBlocked(false);
    // A release build without the bundled native module must fail fast with
    // the true reason — never ask for camera permission and then fail with
    // generic finger guidance while the camera never opens.
    if (provider.kind === 'native' && !provider.isAvailable) {
      if (!mounted.current) return;
      setError(
        isExpoGoPpgRuntime()
          ? 'Heart-rate measurement needs the HealthGraph app build — it cannot run inside Expo Go. Install the preview build and try again.'
          : 'Heart-rate measurement is missing from this build. Install the newest preview build of HealthGraph and try again.',
      );
      return;
    }
    // Camera is only needed for the real on-device provider; the simulation
    // must never trigger a permission prompt.
    if (provider.kind === 'native') {
      const permission = await ensureCameraPermission();
      if (!mounted.current) return;
      if (permission !== 'granted') {
        setPermissionBlocked(permission === 'blocked');
        setError(
          permission === 'blocked'
            ? 'Camera access is turned off for HealthGraph. Enable it in Settings to measure your heart rate.'
            : 'Camera access is needed to measure your heart rate. Your camera images never leave your phone.',
        );
        return;
      }
    }
    try {
      if (startInFlightRef.current) return;
      startInFlightRef.current = true;
      const r = await provider.measure({ durationSeconds });
      if (!mounted.current) return;
      setResult(r);
      if (r.simulated === true) {
        // Simulation: ephemeral by design — never persisted, never synced.
        return;
      }
      // No heart rate produced: surface the native layer's actual reason.
      // A genuinely weak signal keeps finger guidance; startup/hardware
      // failures get their true message (never finger-blame for those).
      if (r.heartRateBpm == null && mounted.current) {
        const reason = r.failureReason;
        if (reason === 'NO_SAMPLES' && (r.framesReceived ?? 0) <= 0) {
          setError(
            'No camera frames were received. Restart the app and try again; if it persists, this device may not support camera measurement.',
          );
        } else if (reason === 'NO_SAMPLES') {
          setError(
            'No usable signal reached the sensor — make sure the flash is on and your fingertip fully covers the camera and flash.',
          );
        } else if (reason === 'LOW_QUALITY') {
          setError(
            'Signal quality too low for a reliable reading. Hold still with your fingertip fully covering the camera and flash, then try again.',
          );
        } else if (reason === 'NO_BEATS') {
          setError(
            'Not enough reliable beats were detected. Hold still with your fingertip fully covering the camera and flash, then try again.',
          );
        } else if (reason === 'UNSTABLE') {
          setError(
            'Your pulse reading was too unstable to trust. Stay still with your fingertip fully covering the camera and flash, then try again.',
          );
        } else if (r.torchEnabled === false) {
          setError(
            'The flash did not turn on, so no pulse signal could be read. Check that another app is not using the camera, then try again.',
          );
        }
      }
      // Offline-first persist (derived only). ONLY successful real runs with
      // an actual heart rate are stored — failed/unreliable runs (null HR)
      // are shown in the UI but never persisted or synced.
      if (r.heartRateBpm == null) {
        return;
      }
      // Offline-first persist (derived only). Works without connectivity.
      // The simulated flag is passed explicitly so the service-layer guard
      // can never be bypassed by flag-stripping, even though sim returns
      // early above and should never reach this call.
      try {
        const out = await saveAndSyncPpgResult({
          heartRateBpm: r.heartRateBpm,
          signalQuality: r.signalQuality,
          durationSeconds: r.durationSeconds,
          rmssdMs: r.rmssdMs ?? null,
          sdnnMs: r.sdnnMs ?? null,
          rrIntervalsMs: r.rrIntervalsMs,
          algorithmVersion: r.algorithmVersion,
          measuredAt: new Date().toISOString(),
          simulated: r.simulated ?? false,
        });
        if (mounted.current) setSynced(out.syncedToServer);
      } catch (e: any) {
        if (mounted.current) setError(e?.message ?? null);
      }
    } catch (e: any) {
      if (!mounted.current) return;
      const cancelled =
        e?.code === 'CANCELLED' || /cancel/i.test(String(e?.message ?? ''));
      if (!cancelled) {
        // Native backstop (permission revoked between the JS check and the
        // CameraX bind). Same safe copy as the JS-side denied path.
        if (e?.code === 'CAMERA_PERMISSION') {
          setError(
            'Camera access is needed to measure your heart rate. Your camera images never leave your phone.',
          );
        } else if (e?.code === 'TORCH_UNAVAILABLE' || e?.code === 'NO_FLASH') {
          setError(
            'The flash could not be enabled, so a pulse reading cannot be taken on this device.',
          );
        } else if (
          e?.code === 'NO_CAMERA' ||
          e?.code === 'NO_LIFECYCLE' ||
          e?.code === 'NO_CONTEXT' ||
          e?.code === 'CAMERA_START'
        ) {
          setError(
            'The camera could not be started. Restart the app and try again.',
          );
        } else {
          setError(e?.message ?? 'Measurement could not be completed. Try again.');
        }
      }
    } finally {
      startInFlightRef.current = false;
    }
  }, [provider]);

  const cancel = useCallback(async () => {
    await provider.cancel();
  }, [provider]);

  const reset = useCallback(() => {
    startInFlightRef.current = false;
    setState('IDLE');
    setResult(null);
    setLiveQuality(null);
    setLiveBpm(null);
    setSynced(null);
    setError(null);
    setPermissionBlocked(false);
  }, []);

  return {
    state,
    hint: PPG_COPY[state],
    result,
    liveQuality,
    liveBpm,
    simulated: provider.kind === 'simulated',
    synced,
    error,
    permissionBlocked,
    start,
    cancel,
    reset,
  };
}
