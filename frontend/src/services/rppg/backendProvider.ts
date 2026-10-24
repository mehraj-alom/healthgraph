/**
 * Backend rPPG Provider — calls FastAPI inference service instead of on-device ONNX.
 *
 * This provider replaces the on-device PhysFormer inference by sending preprocessed
 * tensors to a backend service running the same ONNX model. The contract is identical:
 * input [1, 3, 160, 128, 128] float32 BGR-normalized → output [1, 160] float32 waveform.
 *
 * Configuration via env:
 * - EXPO_PUBLIC_RPPG_BACKEND_URL: Base URL of the rPPG inference API (default: http://localhost:8080)
 * - EXPO_PUBLIC_RPPG_USE_BACKEND: Set to "true" to force backend mode (default: false for dev)
 */

import {
  RPPG_INPUT_DTYPE,
  RPPG_INPUT_ELEMENTS,
  RPPG_INPUT_SHAPE,
  RPPG_OUTPUT_SHAPE,
  RppgInferenceError,
  RppgInputError,
  type RppgModelMetadata,
  type RppgProvider,
  type RppgProviderKind,
  type RppgTensorInput,
  type RppgWaveform,
} from './types';
import { validateRppgInput, validateRppgOutput } from './validation';

const DEFAULT_BACKEND_URL = 'http://localhost:8080';

function getBackendUrl(): string {
  return process.env.EXPO_PUBLIC_RPPG_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

function shouldUseBackend(): boolean {
  return process.env.EXPO_PUBLIC_RPPG_USE_BACKEND === 'true';
}

async function checkBackendHealth(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.status === 'healthy' && data.model_loaded === true;
  } catch {
    return false;
  }
}

/**
 * Create a backend rPPG provider that calls the inference API.
 * Falls back to unavailable if backend is not reachable.
 */
export function createBackendRppgProvider(): RppgProvider {
  const baseUrl = getBackendUrl();
  let available = false;
  let healthChecked = false;

  // Lazily check backend health on first use
  async function ensureBackendAvailable(): Promise<void> {
    if (healthChecked) return;
    healthChecked = true;
    available = await checkBackendHealth(baseUrl);
    console.log(
      `rppg stage: RPPG_BACKEND_PROVIDER health_check url=${baseUrl} available=${available}`,
    );
  }

  return {
    kind: 'backend',
    get isAvailable(): boolean {
      return shouldUseBackend() && available;
    },

    getMetadata(): RppgModelMetadata {
      return {
        modelId: 'physformer-rppg',
        architecture: 'PhysFormer',
        modelVersion: '1.0.0',
        modelLabel: 'physformer-rppg-1.0.0-backend',
        assetFileName: 'physformer_rppg_fp16.onnx',
        inputName: 'video',
        inputShape: [...RPPG_INPUT_SHAPE],
        inputDtype: RPPG_INPUT_DTYPE,
        outputName: 'rppg',
        outputShape: [...RPPG_OUTPUT_SHAPE],
        outputDtype: RPPG_INPUT_DTYPE,
        channelOrder: 'BGR',
        preprocessing:
          'BGR channel order, shape [1,3,160,128,128], float32, ' +
          'normalized = (pixel - 127.5) / 128 ' +
          '(expected range approx -0.99609375 to +0.99609375 for 0-255 pixels). ' +
          'Do NOT convert BGR to RGB.',
        normalizeMean: 127.5,
        normalizeScale: 128,
        graSharp: 2.0,
        onDeviceOnly: false,
      };
    },

    async infer(input: RppgTensorInput): Promise<RppgWaveform> {
      if (!shouldUseBackend()) {
        throw new RppgInferenceError(
          'Backend rPPG provider not enabled. Set EXPO_PUBLIC_RPPG_USE_BACKEND=true.',
        );
      }
      await ensureBackendAvailable();
      if (!available) {
        throw new RppgInferenceError(
          `Backend rPPG inference service unavailable at ${baseUrl}. ` +
            'Check service is running and EXPO_PUBLIC_RPPG_BACKEND_URL is correct.',
        );
      }

      validateRppgInput(input);

      try {
        const resp = await fetch(`${baseUrl}/infer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: Array.from(input.data),
            dims: [...input.dims],
          }),
          // 2 minute timeout for inference (model load + inference)
          signal: AbortSignal.timeout(120_000),
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => 'unknown error');
          throw new RppgInferenceError(
            `Backend inference failed: HTTP ${resp.status} - ${errText}`,
          );
        }

        const payload = await resp.json();

        // Validate response structure
        if (!payload.waveform || !Array.isArray(payload.waveform)) {
          throw new RppgInferenceError('Invalid response: missing waveform array');
        }
        if (!payload.dims || !Array.isArray(payload.dims)) {
          throw new RppgInferenceError('Invalid response: missing dims array');
        }

        const data = new Float32Array(payload.waveform);
        const dims = payload.dims as readonly number[];

        validateRppgOutput(data, dims);

        console.log(
          `rppg stage: RPPG_BACKEND_INFER_SUCCESS len=${data.length} range=[${data[0].toFixed(4)}, ${data[data.length - 1].toFixed(4)}]`,
        );

        return { data, dims };
      } catch (e) {
        if (e instanceof RppgInferenceError) throw e;
        if (e instanceof DOMException && e.name === 'TimeoutError') {
          throw new RppgInferenceError('Backend inference timed out (120s)');
        }
        if (e instanceof TypeError && e.message.includes('fetch')) {
          throw new RppgInferenceError(
            `Cannot reach backend at ${baseUrl}. Network error: ${e.message}`,
          );
        }
        throw new RppgInferenceError(`Backend inference error: ${String(e)}`);
      }
    },

    release(): void {
      // No native resources to release for backend provider
    },
  };
}

/**
 * Check if backend mode is configured and backend is reachable.
 * Useful for UI to show "cloud inference" badge.
 */
export async function isBackendRppgAvailable(): Promise<boolean> {
  if (!shouldUseBackend()) return false;
  return checkBackendHealth(getBackendUrl());
}

export const BACKEND_PROVIDER_DOC = {
  backendUrl: getBackendUrl(),
  inferEndpoint: `${getBackendUrl()}/infer`,
  rawFramesEndpoint: `${getBackendUrl()}/infer_raw_frames`,
  healthEndpoint: `${getBackendUrl()}/health`,
  expectedInputShape: [...RPPG_INPUT_SHAPE],
  expectedOutputShape: [...RPPG_OUTPUT_SHAPE],
} as const;

export type BackendProviderDoc = typeof BACKEND_PROVIDER_DOC;