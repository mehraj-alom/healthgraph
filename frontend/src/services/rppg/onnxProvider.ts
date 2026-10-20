/**
 * On-device PhysFormer inference via ONNX Runtime (`onnxruntime-react-native`).
 *
 * Architecture:  React Native TS → RppgProvider → ONNX Runtime →
 * on-demand physformer_rppg_fp16.onnx (downloaded once via modelManager,
 * verified, cached on device) → Float32 [1,160] waveform.
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
 * dependency below uses a LITERAL specifier inside try/catch.
 */

/**
 * Expo Go hosts no custom native modules: onnxruntime-react-native's JS
 * entrypoint calls Module.install() on a null native module at require
 * time. Short-circuit BEFORE requiring it (same appOwnership pattern the
 * fingertip PPG selector uses) so Expo Go observes a clean unavailable
 * provider with no native-load attempt at all.
 */
function runningInExpoGo(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-constants') as {
      default?: { appOwnership?: string };
      appOwnership?: string;
    };
    const ownership = mod?.default?.appOwnership ?? mod?.appOwnership;
    return ownership === 'expo';
  } catch {
    return false;
  }
}

/**
 * Why the ONNX Runtime backend was (not) selected. The `reason` is a stable
 * machine-readable leg for diagnostics — surfaced in logcat as
 * `rppg stage: pulse provider ...` so a Preview build that reports the
 * model unavailable can be attributed to exactly one cause:
 * - 'expo-go': Expo Go hosts no custom native modules (expected).
 * - 'native-module-absent': `NativeModules.Onnxruntime` is not registered
 *   in this build (stale APK, autolink/build failure) — requiring the JS
 *   package would run its JSI `Module.install()` against an undefined
 *   native module, so it is not attempted.
 * - 'require-failed': the package threw during require (native install
 *   failure). Never a process crash: always caught here.
 * - 'exports-missing': the package loaded but without InferenceSession/Tensor.
 * - 'ok': the runtime binding is usable.
 */
export type OnnxRuntimeStatusReason =
  | 'expo-go'
  | 'native-module-absent'
  | 'require-failed'
  | 'exports-missing'
  | 'ok';

export interface OnnxRuntimeStatus {
  readonly supported: boolean;
  readonly reason: OnnxRuntimeStatusReason;
}

/**
 * Presence probe for the native Onnxruntime binding. Lazy + guarded: never
 * executes third-party native code, never throws, never imports react-native
 * at module scope (which would break node unit tests).
 */
function hasOnnxNativeModule(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as {
      NativeModules?: Record<string, unknown>;
    };
    if (rn?.NativeModules?.['Onnxruntime'] != null) return true;
    // New-arch interop may expose the JSI binding globally without a
    // registered NativeModule entry.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((globalThis as any)?.OrtApi != null) return true;
    return false;
  } catch {
    return false;
  }
}

interface LoadedOrtModule {
  InferenceSession?: {
    create(modelPath: string): Promise<RppgOrtSession>;
  };
  Tensor?: new (
    type: string,
    data: Float32Array,
    dims: number[],
  ) => unknown;
}

/**
 * Single-probe backend resolution: evaluates each leg in order and returns
 * the usable bindings (if any) together with the exact leg that decided.
 * Never throws; never executes third-party native code before the native
 * binding presence is confirmed.
 */
function probeBindings(): {
  bindings: OnnxRuntimeBindings | null;
  reason: OnnxRuntimeStatusReason;
} {
  try {
    if (runningInExpoGo()) return { bindings: null, reason: 'expo-go' };
    // Probe the native binding BEFORE requiring the JS package: its
    // module-scope `Module.install()` is a blocking synchronous JSI call
    // that must never run against an absent native module, and must never
    // run during the React render phase (callers resolve lazily in start()).
    if (!hasOnnxNativeModule()) {
      return { bindings: null, reason: 'native-module-absent' };
    }
    let mod: LoadedOrtModule | null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('onnxruntime-react-native') as LoadedOrtModule | null;
    } catch {
      return { bindings: null, reason: 'require-failed' };
    }
    if (!mod || !mod.InferenceSession || !mod.Tensor) {
      return { bindings: null, reason: 'exports-missing' };
    }
    const InferenceSession = mod.InferenceSession;
    const Tensor = mod.Tensor;
    return {
      bindings: {
        createSession: (modelPath: string) => InferenceSession.create(modelPath),
        createTensor: (data: Float32Array, dims: readonly number[]) =>
          new Tensor(RPPG_INPUT_DTYPE, data, [...dims]),
      },
      reason: 'ok',
    };
  } catch {
    return { bindings: null, reason: 'require-failed' };
  }
}

function defaultBindings(): OnnxRuntimeBindings | null {
  try {
    return probeBindings().bindings;
  } catch {
    return null;
  }
}

/** Evaluate the ONNX Runtime backend legs in order. Never throws. */
export function getOnnxRuntimeStatus(): OnnxRuntimeStatus {
  try {
    const probed = probeBindings();
    return { supported: probed.bindings !== null, reason: probed.reason };
  } catch {
    return { supported: false, reason: 'require-failed' };
  }
}

/** True when the ONNX Runtime native module can be loaded here. Never throws. */
export function isOnnxRuntimeSupported(): boolean {
  try {
    return getOnnxRuntimeStatus().supported;
  } catch {
    return false;
  }
}

/**
 * Resolve the PhysFormer model path via the on-demand model manager.
 *
 * The .onnx is NOT bundled (no require() — Metro would package 17 MB).
 * First rPPG use downloads + verifies it; every later use reuses the cache,
 * including fully offline. Throws RppgInferenceError with a distinct
 * "not installed" message when no valid cache exists so the UI can route
 * to download instead of reporting a model failure.
 */
async function defaultResolveModelPath(): Promise<string> {
  let manager: typeof import('./modelManager');
  try {
    // Lazy: keeps node-test imports of this module free of expo-file-system.
    manager = await import('./modelManager');
  } catch {
    throw new RppgInferenceError(
      'the on-device model manager could not be loaded in this runtime.',
    );
  }
  let uri: string;
  try {
    uri = await manager.getLocalRppgModelPath();
  } catch {
    throw new RppgInferenceError(
      'MODEL_NOT_INSTALLED: the PhysFormer model is not on this device yet.',
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
      console.log('rppg stage: RPPG_MODEL_INIT_START');
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
      const session = await sessionPromise;
      console.log('rppg stage: RPPG_MODEL_INIT_SUCCESS');
      return { session, bindings };
    } catch (e) {
      sessionPromise = null;
      // Diagnostics only: exception class + message. Never tensor contents,
      // frames, or health data.
      const name = e instanceof Error ? e.constructor.name : typeof e;
      console.log(
        `rppg stage: RPPG_MODEL_INIT_FAILURE error=${name} message=${errorMessage(e)}`,
      );
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

    release(): void {
      // Drop the cached session so the native model resources can be
      // garbage-collected when the measurement flow is torn down (e.g. the
      // rPPG screen unmounts). In-flight infer() calls hold their own
      // session reference via ensureSession(), so release never invalidates
      // running work — the next infer() lazily recreates the session.
      sessionPromise = null;
    },
  };
}

export const RPPG_ONNX_DOC = {
  inputDtype: RPPG_INPUT_DTYPE,
  inputShape: [...RPPG_INPUT_SHAPE],
  outputDtype: RPPG_OUTPUT_DTYPE,
  outputShape: [...RPPG_OUTPUT_SHAPE],
};
