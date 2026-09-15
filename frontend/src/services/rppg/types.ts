/**
 * rPPG provider boundary — PhysFormer on-device inference layer.
 *
 * Face rPPG and fingertip PPG are SEPARATE modalities. This namespace must
 * never import from `services/ppg`, `healthgraph-ppg`, or any camera / face
 * detection / HR / HRV / signal-quality / persistence / sync code.
 *
 * Validated model contract (exact, do not relax):
 * - asset:        physformer_rppg_fp16.onnx (FP16 weights, FP32 I/O)
 * - input:        [1, 3, 160, 128, 128], float32, name 'video'
 * - output:       [1, 160], float32, name 'rppg'
 * - channels:     BGR (official PhysFormer/OpenCV ordering — do NOT convert)
 * - normalize:    (pixel - 127.5) / 128  →  [-0.99609375, +0.99609375]
 * - gra_sharp:    2.0, already embedded in the ONNX graph — NOT a runtime input
 *
 * The provider returns the RAW rPPG waveform only. It never returns BPM,
 * HRV, diagnoses, or classifications — those belong to later increments.
 */

export type RppgProviderKind = 'onnx' | 'unavailable';

export type RppgDtype = 'float32';

/** Stable application-level identity for the validated FP16 model. */
export const RPPG_MODEL_ID = 'physformer-rppg';
export const RPPG_MODEL_VERSION = '1.0.0';
export const RPPG_MODEL_LABEL = 'physformer-rppg-1.0.0';
export const RPPG_ARCHITECTURE = 'PhysFormer';
export const RPPG_MODEL_ASSET = 'physformer_rppg_fp16.onnx';

/** ONNX graph I/O names (verified against the validated export). */
export const RPPG_INPUT_NAME = 'video';
export const RPPG_OUTPUT_NAME = 'rppg';

/** Exact expected shapes. [batch, channels, frames, height, width]. */
export const RPPG_INPUT_SHAPE: readonly number[] = [1, 3, 160, 128, 128];
export const RPPG_OUTPUT_SHAPE: readonly number[] = [1, 160];

export const RPPG_INPUT_DTYPE: RppgDtype = 'float32';
export const RPPG_OUTPUT_DTYPE: RppgDtype = 'float32';

export const RPPG_INPUT_ELEMENTS = 1 * 3 * 160 * 128 * 128;
export const RPPG_OUTPUT_ELEMENTS = 160;

/**
 * Exact preprocessing contract. Frames MUST be BGR-ordered float32 already
 * normalized with (pixel - 127.5) / 128 before calling infer(). The provider
 * never reorders channels or rescales — it only validates.
 */
export const RPPG_CHANNEL_ORDER = 'BGR';
export const RPPG_NORMALIZE_MEAN = 127.5;
export const RPPG_NORMALIZE_SCALE = 128;
export const RPPG_NORMALIZE_MIN = -0.99609375;
export const RPPG_NORMALIZE_MAX = 0.99609375;

/**
 * gra_sharp=2.0 is baked into the ONNX graph at export time. It is recorded
 * here for traceability only and MUST NOT be exposed as a caller parameter.
 */
export const RPPG_GRA_SHARP = 2.0;

export const RPPG_PREPROCESSING_DOC =
  'BGR channel order, shape [1,3,160,128,128], float32, ' +
  'normalized = (pixel - 127.5) / 128 ' +
  '(expected range approx -0.99609375 to +0.99609375 for 0-255 pixels). ' +
  'Do NOT convert BGR to RGB.';

/** A prepared 160-frame face/ROI tensor. Camera/ROI code fills this later. */
export interface RppgTensorInput {
  readonly data: Float32Array;
  readonly dims: readonly number[];
  readonly dtype: RppgDtype;
}

/** Raw 160-sample rPPG waveform. No BPM/HRV — waveform only. */
export interface RppgWaveform {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export interface RppgModelMetadata {
  readonly modelId: typeof RPPG_MODEL_ID;
  readonly architecture: typeof RPPG_ARCHITECTURE;
  readonly modelVersion: typeof RPPG_MODEL_VERSION;
  readonly modelLabel: typeof RPPG_MODEL_LABEL;
  readonly assetFileName: typeof RPPG_MODEL_ASSET;
  readonly inputName: typeof RPPG_INPUT_NAME;
  readonly inputShape: readonly number[];
  readonly inputDtype: RppgDtype;
  readonly outputName: typeof RPPG_OUTPUT_NAME;
  readonly outputShape: readonly number[];
  readonly outputDtype: RppgDtype;
  readonly channelOrder: typeof RPPG_CHANNEL_ORDER;
  readonly preprocessing: typeof RPPG_PREPROCESSING_DOC;
  readonly normalizeMean: typeof RPPG_NORMALIZE_MEAN;
  readonly normalizeScale: typeof RPPG_NORMALIZE_SCALE;
  /** Embedded in the graph — informational only, never a runtime input. */
  readonly graSharp: typeof RPPG_GRA_SHARP;
  readonly onDeviceOnly: true;
}

export const RPPG_MODEL_METADATA: RppgModelMetadata = {
  modelId: RPPG_MODEL_ID,
  architecture: RPPG_ARCHITECTURE,
  modelVersion: RPPG_MODEL_VERSION,
  modelLabel: RPPG_MODEL_LABEL,
  assetFileName: RPPG_MODEL_ASSET,
  inputName: RPPG_INPUT_NAME,
  inputShape: RPPG_INPUT_SHAPE,
  inputDtype: RPPG_INPUT_DTYPE,
  outputName: RPPG_OUTPUT_NAME,
  outputShape: RPPG_OUTPUT_SHAPE,
  outputDtype: RPPG_OUTPUT_DTYPE,
  channelOrder: RPPG_CHANNEL_ORDER,
  preprocessing: RPPG_PREPROCESSING_DOC,
  normalizeMean: RPPG_NORMALIZE_MEAN,
  normalizeScale: RPPG_NORMALIZE_SCALE,
  graSharp: RPPG_GRA_SHARP,
  onDeviceOnly: true,
};

/**
 * Platform-agnostic inference interface. Implementations must not depend on
 * React components, screens, navigation, camera, face detection, backend,
 * database, HR, HRV, or signal-quality code.
 */
export interface RppgProvider {
  readonly kind: RppgProviderKind;
  /** Whether this provider can run inference in the current runtime. */
  readonly isAvailable: boolean;
  getMetadata(): RppgModelMetadata;
  infer(input: RppgTensorInput): Promise<RppgWaveform>;
}

/** Thrown when the caller supplies a malformed inference tensor. */
export class RppgInputError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(`[rppg] invalid inference input: ${message}`);
    this.name = 'RppgInputError';
    this.code = 'INVALID_RPPG_INPUT';
  }
}

/** Thrown when the model/runtime fails (load error, bad output, etc.). */
export class RppgInferenceError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(`[rppg] inference failed: ${message}`);
    this.name = 'RppgInferenceError';
    this.code = 'RPPG_INFERENCE_FAILED';
  }
}
