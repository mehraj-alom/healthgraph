/**
 * rPPG input/output validation — pure TypeScript, no runtime dependencies.
 *
 * Strict by design: malformed tensors are REJECTED with a clear error. The
 * layer never reshapes, transposes, resizes, reinterprets dimensions, or
 * converts channel order — callers must supply the exact validated contract.
 */

import {
  RPPG_INPUT_DTYPE,
  RPPG_INPUT_ELEMENTS,
  RPPG_INPUT_SHAPE,
  RPPG_NORMALIZE_MAX,
  RPPG_NORMALIZE_MEAN,
  RPPG_NORMALIZE_MIN,
  RPPG_NORMALIZE_SCALE,
  RPPG_OUTPUT_DTYPE,
  RPPG_OUTPUT_ELEMENTS,
  RPPG_OUTPUT_SHAPE,
  RppgInferenceError,
  RppgInputError,
  type RppgTensorInput,
} from './types';

function dimsToString(dims: unknown): string {
  try {
    return JSON.stringify(dims);
  } catch {
    return String(dims);
  }
}

function shapesEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Official PhysFormer normalization: (pixel - 127.5) / 128. */
export function rppgNormalizePixel(pixel: number): number {
  return (pixel - RPPG_NORMALIZE_MEAN) / RPPG_NORMALIZE_SCALE;
}

/**
 * Validate a caller-supplied inference tensor against the exact model
 * contract: [1,3,160,128,128] float32 BGR-normalized finite values.
 * Throws RppgInputError on any violation.
 */
export function validateRppgInput(
  input: unknown,
): asserts input is RppgTensorInput {
  if (input === null || typeof input !== 'object') {
    throw new RppgInputError(
      'input must be an object { data: Float32Array, dims, dtype: "float32" }; ' +
        `received ${input === null ? 'null' : typeof input}.`,
    );
  }
  const tensor = input as {
    data?: unknown;
    dims?: unknown;
    dtype?: unknown;
  };
  if (tensor.dtype !== RPPG_INPUT_DTYPE) {
    throw new RppgInputError(
      `dtype must be exactly "${RPPG_INPUT_DTYPE}" (BGR, (pixel - 127.5) / 128); ` +
        `received ${dimsToString(tensor.dtype)}.`,
    );
  }
  if (!Array.isArray(tensor.dims)) {
    throw new RppgInputError(
      `dims must be an array equal to [${RPPG_INPUT_SHAPE.join(',')}]; ` +
        `received ${dimsToString(tensor.dims)}.`,
    );
  }
  if (!shapesEqual(tensor.dims, RPPG_INPUT_SHAPE)) {
    throw new RppgInputError(
      `dims must be exactly [${RPPG_INPUT_SHAPE.join(',')}] ` +
        `(rank 5: batch, channels, frames, height, width); ` +
        `received ${dimsToString(tensor.dims)}. ` +
        'The provider never reshapes or reinterprets dimensions.',
    );
  }
  if (!(tensor.data instanceof Float32Array)) {
    throw new RppgInputError(
      'data must be a Float32Array matching the float32 provider contract; ' +
        `received ${tensor.data === null ? 'null' : typeof tensor.data}.`,
    );
  }
  if (tensor.data.length !== RPPG_INPUT_ELEMENTS) {
    throw new RppgInputError(
      `data length must be exactly ${RPPG_INPUT_ELEMENTS} ` +
        `(1*3*160*128*128) for dims [${RPPG_INPUT_SHAPE.join(',')}]; ` +
        `received ${tensor.data.length}.`,
    );
  }
  for (let i = 0; i < tensor.data.length; i++) {
    if (!Number.isFinite(tensor.data[i])) {
      throw new RppgInputError(
        `data must contain only finite values (NaN/Infinity rejected); ` +
          `first non-finite value at flat index ${i}.`,
      );
    }
  }
}

/**
 * Validate raw ONNX output against the exact contract: [1,160] float32
 * finite values. Throws RppgInferenceError on any violation — unexpected
 * output is never silently reshaped.
 */
export function validateRppgOutput(
  data: unknown,
  dims: unknown,
): asserts data is Float32Array {
  if (!Array.isArray(dims) || !shapesEqual(dims, RPPG_OUTPUT_SHAPE)) {
    throw new RppgInferenceError(
      `model output dims must be exactly [${RPPG_OUTPUT_SHAPE.join(',')}]; ` +
        `received ${dimsToString(dims)}.`,
    );
  }
  if (!(data instanceof Float32Array)) {
    throw new RppgInferenceError(
      `model output dtype must be ${RPPG_OUTPUT_DTYPE} (Float32Array); ` +
        `received ${data === null ? 'null' : typeof data}.`,
    );
  }
  if (data.length !== RPPG_OUTPUT_ELEMENTS) {
    throw new RppgInferenceError(
      `model output length must be exactly ${RPPG_OUTPUT_ELEMENTS}; ` +
        `received ${data.length}.`,
    );
  }
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) {
      throw new RppgInferenceError(
        `model output must contain only finite values; ` +
          `first non-finite value at index ${i}.`,
      );
    }
  }
}

export const RPPG_VALIDATION_DOC = {
  normalizeMin: RPPG_NORMALIZE_MIN,
  normalizeMax: RPPG_NORMALIZE_MAX,
};
