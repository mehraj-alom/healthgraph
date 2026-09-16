/**
 * rPPG preprocessor — sealed window file → PhysFormer tensor. Pure TypeScript.
 *
 * Contract (exact, never relaxed here):
 * - input:  RPPG window v1 with EXACTLY 160 frames of 128x128 BGR bytes
 * - output: [1,3,160,128,128] float32, BGR plane order, (pixel-127.5)/128
 * - fps:    measured window rate must lie within [27,33] Hz, else refuse
 *
 * Never reshapes, transposes, resizes, or converts channels. Incomplete or
 * corrupted windows are rejected — never fed to the model.
 */

import { RppgWindowError } from './frameWindow';
import {
  RPPG_FPS_MAX,
  RPPG_FPS_MIN,
  RPPG_INPUT_ELEMENTS,
  RPPG_INPUT_SHAPE,
  RPPG_NORMALIZE_MEAN,
  RPPG_NORMALIZE_SCALE,
  RPPG_WINDOW_FRAMES,
  RPPG_WINDOW_ROI,
  type RppgTensorInput,
} from './types';
import type { RppgWindowFile } from './frameWindow';

export class RppgPreprocessError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(`[rppg] preprocessing refused: ${message}`);
    this.name = 'RppgPreprocessError';
    this.code = 'INVALID_RPPG_WINDOW';
  }
}

export interface PreprocessedWindow {
  readonly input: RppgTensorInput;
  /** Effective fps measured from window timestamps (Hz). */
  readonly fpsMeasured: number;
}

/** Effective rate from first/last timestamps (Hz). Null when unmeasurable. */
export function measuredFps(timestampsMs: readonly number[]): number | null {
  if (timestampsMs.length < 2) return null;
  const first = timestampsMs[0];
  const last = timestampsMs[timestampsMs.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  return ((timestampsMs.length - 1) * 1000) / (last - first);
}

/**
 * Assemble the exact model tensor from a parsed window file.
 * Throws RppgPreprocessError (or RppgWindowError) on any contract violation.
 */
export function preprocessWindow(window: RppgWindowFile): PreprocessedWindow {
  if (window.frameCount !== RPPG_WINDOW_FRAMES) {
    throw new RppgPreprocessError(
      `window holds ${window.frameCount} frames; PhysFormer requires exactly ${RPPG_WINDOW_FRAMES}. ` +
        'Incomplete windows are never fed to the model.',
    );
  }
  if (window.roiSize !== RPPG_WINDOW_ROI) {
    throw new RppgPreprocessError(
      `window ROI ${window.roiSize} does not match the model contract (${RPPG_WINDOW_ROI}).`,
    );
  }
  const fps = measuredFps(window.timestampsMs);
  if (fps === null) {
    throw new RppgPreprocessError('window timestamps cannot establish a capture rate.');
  }
  if (!(fps >= RPPG_FPS_MIN && fps <= RPPG_FPS_MAX)) {
    throw new RppgPreprocessError(
      `measured capture rate ${fps.toFixed(2)} Hz is outside the supported ` +
        `[${RPPG_FPS_MIN}, ${RPPG_FPS_MAX}] Hz band. Reacquire; never interpolate.`,
    );
  }
  const frameBytes = RPPG_WINDOW_ROI * RPPG_WINDOW_ROI * 3;
  if (window.bgr.length !== RPPG_WINDOW_FRAMES * frameBytes) {
    throw new RppgWindowError(
      `BGR payload ${window.bgr.length} bytes does not match ${RPPG_WINDOW_FRAMES} frames.`,
    );
  }
  // Layout [1,3,160,128,128]: flat index ((c*160)+f)*16384 + (y*128+x).
  // B input bytes stay BGR: byte0 -> channel 0, byte1 -> 1, byte2 -> 2.
  const data = new Float32Array(RPPG_INPUT_ELEMENTS);
  for (let f = 0; f < RPPG_WINDOW_FRAMES; f++) {
    writeFrameToTensor(data, window.bgr, f);
  }
  return {
    input: { data, dims: [...RPPG_INPUT_SHAPE], dtype: 'float32' },
    fpsMeasured: fps,
  };
}

/**
 * One frame of BGR bytes -> the three normalized channel planes.
 * Shared verbatim by the sync and yielding preprocessors so both produce
 * bit-identical tensors (same arithmetic, same write order).
 */
function writeFrameToTensor(data: Float32Array, bgr: Uint8Array, f: number): void {
  const planeFrames = RPPG_WINDOW_FRAMES;
  const planePixels = RPPG_WINDOW_ROI * RPPG_WINDOW_ROI;
  const srcBase = f * RPPG_WINDOW_ROI * RPPG_WINDOW_ROI * 3;
  for (let p = 0; p < planePixels; p++) {
    const b = bgr[srcBase + p * 3];
    const g = bgr[srcBase + p * 3 + 1];
    const r = bgr[srcBase + p * 3 + 2];
    const base = f * planePixels + p;
    data[base] = (b - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
    data[planePixels * planeFrames + base] =
      (g - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
    data[2 * planePixels * planeFrames + base] =
      (r - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Yielding variant of preprocessWindow for the live measurement path.
 * Identical validation and bit-identical tensor output; yields to the JS
 * event loop every 20 frames so the ~7.9M-element fill does not block the
 * JS thread for one continuous ~0.2-0.5 s stall (UI stays responsive and
 * cancel remains prompt between chunks). The sync preprocessWindow above is
 * untouched and remains the contract-tested reference.
 */
export async function preprocessWindowYielding(
  window: RppgWindowFile,
): Promise<PreprocessedWindow> {
  if (window.frameCount !== RPPG_WINDOW_FRAMES) {
    throw new RppgPreprocessError(
      `window holds ${window.frameCount} frames; PhysFormer requires exactly ${RPPG_WINDOW_FRAMES}. ` +
        'Incomplete windows are never fed to the model.',
    );
  }
  if (window.roiSize !== RPPG_WINDOW_ROI) {
    throw new RppgPreprocessError(
      `window ROI ${window.roiSize} does not match the model contract (${RPPG_WINDOW_ROI}).`,
    );
  }
  const fps = measuredFps(window.timestampsMs);
  if (fps === null) {
    throw new RppgPreprocessError('window timestamps cannot establish a capture rate.');
  }
  if (!(fps >= RPPG_FPS_MIN && fps <= RPPG_FPS_MAX)) {
    throw new RppgPreprocessError(
      `measured capture rate ${fps.toFixed(2)} Hz is outside the supported ` +
        `[${RPPG_FPS_MIN}, ${RPPG_FPS_MAX}] Hz band. Reacquire; never interpolate.`,
    );
  }
  const frameBytes = RPPG_WINDOW_ROI * RPPG_WINDOW_ROI * 3;
  if (window.bgr.length !== RPPG_WINDOW_FRAMES * frameBytes) {
    throw new RppgWindowError(
      `BGR payload ${window.bgr.length} bytes does not match ${RPPG_WINDOW_FRAMES} frames.`,
    );
  }
  const data = new Float32Array(RPPG_INPUT_ELEMENTS);
  for (let f = 0; f < RPPG_WINDOW_FRAMES; f++) {
    writeFrameToTensor(data, window.bgr, f);
    if (f % 20 === 19) {
      // Let cancellation, timers, and UI work interleave between chunks.
      await yieldToEventLoop();
    }
  }
  return {
    input: { data, dims: [...RPPG_INPUT_SHAPE], dtype: 'float32' },
    fpsMeasured: fps,
  };
}
