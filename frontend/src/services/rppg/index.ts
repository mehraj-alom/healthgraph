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

import { createOnnxRppgProvider, isOnnxRuntimeSupported } from './onnxProvider';
import { createUnavailableRppgProvider } from './unavailableProvider';
import type { RppgProvider } from './types';

export * from './types';
export { validateRppgInput, validateRppgOutput, rppgNormalizePixel } from './validation';
export { createOnnxRppgProvider, isOnnxRuntimeSupported } from './onnxProvider';
export { createUnavailableRppgProvider } from './unavailableProvider';
export { buildRppgSmokeTensor, runRppgDevValidation } from './devValidate';
export type { RppgDevValidationResult } from './devValidate';

let cached: RppgProvider | null = null;

/** Select the usable rPPG provider for this runtime (cached). */
export function getRppgProvider(): RppgProvider {
  if (!cached) {
    let useOnnx = false;
    try {
      useOnnx = isOnnxRuntimeSupported();
    } catch {
      useOnnx = false;
    }
    cached = useOnnx
      ? createOnnxRppgProvider()
      : createUnavailableRppgProvider(
          'onnxruntime-react-native could not be loaded in this runtime, ' +
            'so the on-device PhysFormer model cannot run here.',
        );
  }
  return cached;
}

/** Test seam: reset the cached selection. */
export function __resetRppgProviderForTests(): void {
  cached = null;
}
