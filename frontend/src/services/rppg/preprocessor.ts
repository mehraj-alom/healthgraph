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
  const planeFrames = RPPG_WINDOW_FRAMES;
  const planePixels = RPPG_WINDOW_ROI * RPPG_WINDOW_ROI;
  for (let f = 0; f < RPPG_WINDOW_FRAMES; f++) {
    const srcBase = f * frameBytes;
    for (let p = 0; p < planePixels; p++) {
      const b = window.bgr[srcBase + p * 3];
      const g = window.bgr[srcBase + p * 3 + 1];
      const r = window.bgr[srcBase + p * 3 + 2];
      const base = f * planePixels + p;
      data[base] = (b - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
      data[planePixels * planeFrames + base] =
        (g - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
      data[2 * planePixels * planeFrames + base] =
        (r - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
    }
  }
  return {
    input: { data, dims: [...RPPG_INPUT_SHAPE], dtype: 'float32' },
    fpsMeasured: fps,
  };
}
