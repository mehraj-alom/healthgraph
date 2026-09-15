/**
 * On-device PhysFormer inference via ONNX Runtime (`onnxruntime-react-native`).
 *
 * Architecture:  React Native TS → RppgProvider → ONNX Runtime →
 * bundled physformer_rppg_fp16.onnx → Float32 [1,160] waveform.
 *
 * No server inference: camera frames / tensors never leave the device in
 * this layer, and no network calls are made here. Logs (if any, by callers)
 * must contain only safe metadata — never tensor contents.
 *
 * Importing this module is safe in every runtime (Expo Go, web, node tests):
 * native/bundler dependencies are resolved LAZILY inside functions and
 * guarded, so a missing runtime degrades to a clear unavailable error —
 * the app never crashes. Tests inject stub bindings via
 * OnnxRppgProviderOptions instead of touching the real runtime.
 */

import {
  RPPG_INPUT_DTYPE,
  RPPG_INPUT_NAME,
  RPPG_INPUT_SHAPE,
  RPPG_MODEL_METADATA,
  RPPG_OUTPUT_DTYPE,
  RPPG_OUTPUT_NAME,
  RPPG_OUTPUT_SHAPE,
  RppgInferenceError,
  type RppgModelMetadata,
  type RppgProvider,
  type RppgTensorInput,
  type RppgWaveform,
} from './types';
import { validateRppgInput, validateRppgOutput } from './validation';

/** Minimal structural surface used from onnxruntime-react-native. */
export interface RppgOrtTensor {
  readonly data: unknown;
  readonly dims: unknown;
}

export interface RppgOrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, RppgOrtTensor>>;
}

export interface OnnxRuntimeBindings {
  createSession(modelPath: string): Promise<RppgOrtSession>;
  createTensor(data: Float32Array, dims: readonly number[]): unknown;
}

export interface OnnxRppgProviderOptions {
  /**
   * Runtime bindings. Default (undefined): probe the real
   * onnxruntime-react-native installation. Explicit null: force the
   * unavailable path without probing (useful for tests/dev toggles).
   */
  bindings?: OnnxRuntimeBindings | null;
  /** Override how the bundled model file path is resolved (test seam). */
  resolveModelPath?: () => Promise<string>;
}

/**
 * Metro requires statically-analyzable require calls: every runtime
 * dependency below uses a LITERAL specifier inside try/catch. Bundling
 * always includes them; on runtimes without the native side (Expo Go,
 * web, node tests) the require throws and the provider degrades to
 * unavailable — the app never crashes.
 */
function loadOnnxRuntime(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('onnxruntime-react-native');
  } catch {
    return null;
  }
}

function loadExpoAsset(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-asset');
  } catch {
    return null;
  }
}

function defaultBindings(): OnnxRuntimeBindings | null {
  const mod = loadOnnxRuntime() as {
    InferenceSession?: {
      create(modelPath: string): Promise<RppgOrtSession>;
    };
    Tensor?: new (
      type: string,
      data: Float32Array,
      dims: number[],
    ) => unknown;
  } | null;
  if (!mod || !mod.InferenceSession || !mod.Tensor) return null;
  const InferenceSession = mod.InferenceSession;
  const Tensor = mod.Tensor;
  return {
    createSession: (modelPath: string) => InferenceSession.create(modelPath),
    createTensor: (data: Float32Array, dims: readonly number[]) =>
      new Tensor(RPPG_INPUT_DTYPE, data, [...dims]),
  };
}

/** True when the ONNX Runtime native module can be loaded here. Never throws. */
export function isOnnxRuntimeSupported(): boolean {
  try {
    return defaultBindings() !== null;
  } catch {
    return false;
  }
}

/**
 * Resolve the bundled FP16 model to a local file path ONNX Runtime can open.
 * Uses expo-asset (same pattern as the existing .glb/.wasm asset loading).
 */
async function defaultResolveModelPath(): Promise<string> {
  const expoAsset = loadExpoAsset() as {
    Asset?: {
      loadAsync(
        moduleId: number,
      ): Promise<
        Array<{
          localUri?: string | null;
          uri: string;
          downloadAsync?: () => Promise<unknown>;
        }>
      >;
    };
  } | null;
  if (!expoAsset || !expoAsset.Asset) {
    throw new RppgInferenceError(
      'expo-asset is unavailable, so the bundled rPPG model cannot be resolved.',
    );
  }
  // Literal require: Metro must see the path statically to bundle the .onnx.
  let assetId: number;
  try {
    assetId =
      require('../../../assets/models/rppg/physformer_rppg_fp16.onnx') as number;
  } catch {
    throw new RppgInferenceError(
      'the bundled rPPG model asset (physformer_rppg_fp16.onnx) could not be resolved.',
    );
  }
  if (typeof assetId !== 'number') {
    throw new RppgInferenceError(
      'the bundled rPPG model asset did not resolve to a Metro asset id.',
    );
  }
  const loaded = await expoAsset.Asset.loadAsync(assetId);
  const resolved = loaded[0];
  if (!resolved) {
    throw new RppgInferenceError(
      'expo-asset returned no entry for the bundled rPPG model.',
    );
  }
  try {
    await resolved.downloadAsync?.();
  } catch {
    throw new RppgInferenceError(
      'the bundled rPPG model could not be downloaded to device storage.',
    );
  }
  const uri = resolved.localUri ?? resolved.uri;
  if (!uri) {
    throw new RppgInferenceError(
      'expo-asset produced no usable URI for the bundled rPPG model.',
    );
  }
  // ONNX Runtime opens plain filesystem paths; strip the file:// scheme.
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  try {
    return String(e);
  } catch {
    return 'unknown error';
  }
}

/**
 * Create the ONNX-backed rPPG provider. Session creation is lazy (first
 * infer() call) and cached; failures reset the cached promise so a later
 * call can retry. Input is validated before inference, output after —
 * malformed data always fails loudly, never silently reshaped.
 */
export function createOnnxRppgProvider(
  options: OnnxRppgProviderOptions = {},
): RppgProvider {
  const explicit = options.bindings !== undefined;
  const staticBindings: OnnxRuntimeBindings | null = explicit
    ? (options.bindings as OnnxRuntimeBindings | null)
    : defaultBindings();
  const resolveModelPath = options.resolveModelPath ?? defaultResolveModelPath;

  let sessionPromise: Promise<RppgOrtSession> | null = null;

  async function ensureSession(): Promise<{
    session: RppgOrtSession;
    bindings: OnnxRuntimeBindings;
  }> {
    if (!staticBindings) {
      throw new RppgInferenceError(
        'ONNX Runtime (onnxruntime-react-native) is unavailable in this ' +
          'runtime. rPPG inference requires a custom dev/production build; ' +
          'the app must surface rPPG as unavailable instead of crashing.',
      );
    }
    const bindings = staticBindings;
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const modelPath = await resolveModelPath();
        if (!modelPath) {
          throw new RppgInferenceError(
            'model path resolution returned an empty path.',
          );
        }
        return bindings.createSession(modelPath);
      })();
    }
    try {
      return { session: await sessionPromise, bindings };
    } catch (e) {
      sessionPromise = null;
      if (e instanceof RppgInferenceError) throw e;
      throw new RppgInferenceError(
        `the PhysFormer model could not be loaded: ${errorMessage(e)}`,
      );
    }
  }

  return {
    kind: 'onnx',
    isAvailable: staticBindings !== null,

    getMetadata(): RppgModelMetadata {
      return RPPG_MODEL_METADATA;
    },

    async infer(input: RppgTensorInput): Promise<RppgWaveform> {
      validateRppgInput(input);
      const { session, bindings } = await ensureSession();
      const tensor = bindings.createTensor(input.data, input.dims);
      let raw: Record<string, RppgOrtTensor>;
      try {
        raw = await session.run({ [RPPG_INPUT_NAME]: tensor });
      } catch (e) {
        throw new RppgInferenceError(
          `PhysFormer session execution failed: ${errorMessage(e)}`,
        );
      }
      const out = raw[RPPG_OUTPUT_NAME];
      if (!out || typeof out !== 'object') {
        const keys = raw && typeof raw === 'object' ? Object.keys(raw) : [];
        throw new RppgInferenceError(
          `model output "${RPPG_OUTPUT_NAME}" is missing ` +
            `(received keys: ${keys.join(', ') || '<none>'}).`,
        );
      }
      validateRppgOutput(out.data, out.dims);
      return { data: out.data, dims: [...RPPG_OUTPUT_SHAPE] };
    },
  };
}

export const RPPG_ONNX_DOC = {
  inputDtype: RPPG_INPUT_DTYPE,
  inputShape: [...RPPG_INPUT_SHAPE],
  outputDtype: RPPG_OUTPUT_DTYPE,
  outputShape: [...RPPG_OUTPUT_SHAPE],
};
