/**
 * rPPG provider selection.
 *
 * - Custom dev/production build with onnxruntime-react-native → ONNX provider
 *   running the bundled PhysFormer FP16 model fully on-device.
 * - Any runtime without ONNX Runtime (Expo Go, web, failed init) →
 *   unavailable provider (explicit, never crashes, never falls back to
 *   fingertip PPG or simulated data).
 *
 * Importing this module is safe in every runtime: native-module resolution
 * is lazy and guarded, so unsupported runtimes never crash on import.
 */

import { createOnnxRppgProvider, getOnnxRuntimeStatus } from './onnxProvider';
import { createUnavailableRppgProvider } from './unavailableProvider';
import type { RppgProvider } from './types';

export * from './types';
export { validateRppgInput, validateRppgOutput, rppgNormalizePixel } from './validation';
export {
  createOnnxRppgProvider,
  isOnnxRuntimeSupported,
  getOnnxRuntimeStatus,
} from './onnxProvider';
export type { OnnxRuntimeStatus, OnnxRuntimeStatusReason } from './onnxProvider';
export { createUnavailableRppgProvider } from './unavailableProvider';
export { buildRppgSmokeTensor, runRppgDevValidation } from './devValidate';
export type { RppgDevValidationResult } from './devValidate';
export { parseRppgWindow, readRppgWindowFile, buildRppgWindowForTests, RppgWindowError } from './frameWindow';
export type { RppgWindowFile, RppgWindowBytesReader } from './frameWindow';
export { FaceTracker, buildTelemetryFixture, mapNativeCaptureState } from './faceTracker';
export type { RppgTelemetrySample, FaceTrackState, FaceTrackSnapshot, FaceTrackerOptions, RppgScreenState } from './faceTracker';
export { preprocessWindow, preprocessWindowYielding, measuredFps, RppgPreprocessError } from './preprocessor';
export type { PreprocessedWindow } from './preprocessor';
export { estimateRppgHeartRate, buildSineWaveform } from './hrEstimator';
export type { RppgHrEstimate, RppgHrRejectReason } from './hrEstimator';
export { gateRppgQuality, rppgReliableForPersistence, RPPG_Q } from './qualityGate';
export type { RppgQualityLevel, RppgQualityInput, RppgQualityResult } from './qualityGate';
export { createRppgFrameSource, getRppgFrameSource, isExpoGoRuntime, __resetRppgFrameSourceForTests } from './frameSource';
export type { RppgFrameSource, RppgFrameSourceKind, RppgFrameSourceDeps } from './frameSource';
// NOTE: cameraPermission is intentionally NOT re-exported here: it imports
// react-native at module scope, which would break node unit tests that stage
// this barrel. Import it directly from '@/services/rppg/cameraPermission'.

let cached: RppgProvider | null = null;

/** Select the usable rPPG provider for this runtime (cached). */
export function getRppgProvider(): RppgProvider {
  if (!cached) {
    let status = { supported: false, reason: 'require-failed' } as ReturnType<
      typeof getOnnxRuntimeStatus
    >;
    try {
      status = getOnnxRuntimeStatus();
    } catch {
      // Keep the default unavailable status above.
    }
    // RPPG_PROVIDER_SELECT with the exact failing leg. Metadata only —
    // never frames, tensors, or health data.
    console.log(
      `rppg stage: RPPG_PROVIDER_SELECT supported=${status.supported} reason=${status.reason}`,
    );
    cached = status.supported
      ? createOnnxRppgProvider()
      : createUnavailableRppgProvider(
          `onnxruntime-react-native could not be loaded in this runtime ` +
            `(reason: ${status.reason}), so the on-device PhysFormer model ` +
            `cannot run here.`,
        );
  }
  return cached;
}

/** Test seam: reset the cached selection. */
export function __resetRppgProviderForTests(): void {
  cached = null;
}

/**
 * Release the cached provider's native resources (ONNX session) when the
 * rPPG flow is torn down (screen unmount). Never throws; safe to call when
 * idle or unavailable. The next getRppgProvider() re-resolves lazily, so a
 * later measurement simply re-initializes the session on demand.
 */
export function releaseRppgProvider(): void {
  try {
    cached?.release?.();
  } catch {
    // Release is best-effort; a throwing release must never break teardown.
  } finally {
    cached = null;
  }
}
