/**
 * Unavailable rPPG provider — used when ONNX Runtime cannot run here
 * (Expo Go, web, missing native module, asset unresolvable, init failure).
 *
 * It exposes the model identity via getMetadata() but refuses every infer()
 * call with a clear error instead of crashing. It NEVER falls back to
 * fingertip PPG, simulated PPG, or a different model.
 */

import {
  RPPG_MODEL_METADATA,
  type RppgModelMetadata,
  type RppgProvider,
  type RppgTensorInput,
  type RppgWaveform,
} from './types';

export function createUnavailableRppgProvider(reason: string): RppgProvider {
  const safeReason =
    typeof reason === 'string' && reason.trim().length > 0
      ? reason.trim()
      : 'ONNX Runtime is unavailable in this runtime.';

  return {
    kind: 'unavailable',
    isAvailable: false,

    getMetadata(): RppgModelMetadata {
      return RPPG_MODEL_METADATA;
    },

    infer(_input: RppgTensorInput): Promise<RppgWaveform> {
      return Promise.reject(
        new Error(
          `[rppg] inference unavailable: ${safeReason} ` +
            'Use a custom dev/production build with onnxruntime-react-native ' +
            'to run the on-device PhysFormer model.',
        ),
      );
    },
  };
}
