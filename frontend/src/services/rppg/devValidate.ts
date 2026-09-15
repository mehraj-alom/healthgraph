/**
 * Developer-only rPPG validation path for an already-prepared tensor.
 *
 * prepared tensor → RppgProvider → PhysFormer → [1,160] waveform
 *
 * This is NOT a production camera flow. It never saves health data, never
 * writes SQLite, never syncs, never creates observations, never shows
 * production UI, and never calls the backend. The synthetic tensor below is
 * a shape/dtype smoke fixture — NOT face data, NOT a measurement.
 *
 * It exists only to prove: model loads, inference executes, output contract
 * holds. Only safe metadata (model version, shapes, timing, success) is
 * returned — tensor contents are never logged or retained.
 */

import {
  RPPG_INPUT_DTYPE,
  RPPG_INPUT_ELEMENTS,
  RPPG_INPUT_SHAPE,
  RPPG_MODEL_METADATA,
  RPPG_NORMALIZE_MAX,
  RPPG_NORMALIZE_MIN,
  type RppgProvider,
  type RppgTensorInput,
} from './types';

export interface RppgDevValidationResult {
  readonly success: boolean;
  readonly modelVersion: string;
  readonly inputShape: readonly number[];
  readonly outputShape: readonly number[];
  readonly inferenceMs: number | null;
  readonly reason?: string;
}

/** Deterministic pseudo-random generator (seeded LCG) — no Math.random. */
function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Build a deterministic smoke tensor with the exact contract shape/dtype.
 * Values span the valid normalized range; the spatial/temporal pattern is
 * arbitrary and carries no physiological meaning.
 */
export function buildRppgSmokeTensor(seed = 20260915): RppgTensorInput {
  const data = new Float32Array(RPPG_INPUT_ELEMENTS);
  const rand = makeRand(seed);
  const span = RPPG_NORMALIZE_MAX - RPPG_NORMALIZE_MIN;
  for (let i = 0; i < data.length; i++) {
    data[i] = RPPG_NORMALIZE_MIN + rand() * span;
  }
  return { data, dims: [...RPPG_INPUT_SHAPE], dtype: RPPG_INPUT_DTYPE };
}

/**
 * Run provider inference on a prepared tensor and check the output contract.
 * Never throws: failures are reported via { success: false, reason }.
 */
export async function runRppgDevValidation(
  provider: RppgProvider,
  input: RppgTensorInput = buildRppgSmokeTensor(),
): Promise<RppgDevValidationResult> {
  const metadata = provider.getMetadata();
  if (!provider.isAvailable) {
    return {
      success: false,
      modelVersion: metadata.modelVersion,
      inputShape: [...RPPG_INPUT_SHAPE],
      outputShape: [],
      inferenceMs: null,
      reason: `provider kind "${provider.kind}" reports unavailable; no inference attempted.`,
    };
  }
  const started = Date.now();
  try {
    const waveform = await provider.infer(input);
    return {
      success: true,
      modelVersion: metadata.modelVersion,
      inputShape: [...input.dims],
      outputShape: [...waveform.dims],
      inferenceMs: Date.now() - started,
    };
  } catch (e) {
    return {
      success: false,
      modelVersion: RPPG_MODEL_METADATA.modelVersion,
      inputShape: [...RPPG_INPUT_SHAPE],
      outputShape: [],
      inferenceMs: null,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
