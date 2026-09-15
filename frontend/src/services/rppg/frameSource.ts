/**
 * rPPG frame source — capture provider boundary over the HealthGraphRPPG
 * native module (front camera → sealed 160-frame window file).
 *
 * Importing this module is safe in every runtime: the native package is
 * resolved LAZILY and guarded, so Expo Go / web / node tests never crash —
 * they observe the unavailable source explicitly. No frames cross the
 * bridge; capture resolves with a window-file URI + scalar summary only.
 */

import type {
  RppgCaptureOptions,
  RppgCaptureResult,
  RppgNativeEvent,
} from 'healthgraph-rppg';

export type RppgFrameSourceKind = 'native' | 'unavailable';

export interface RppgFrameSource {
  readonly kind: RppgFrameSourceKind;
  readonly isAvailable: boolean;
  capture(options?: RppgCaptureOptions): Promise<RppgCaptureResult>;
  cancel(): Promise<void>;
  addListener(listener: (event: RppgNativeEvent) => void): () => void;
}

export interface RppgFrameSourceDeps {
  startCapture?: (options: RppgCaptureOptions) => Promise<RppgCaptureResult>;
  cancelCapture?: () => Promise<void>;
  addListener?: (listener: (event: RppgNativeEvent) => void) => () => void;
  isAvailable?: boolean;
}

function loadNative(): {
  startCapture: (options: RppgCaptureOptions) => Promise<RppgCaptureResult>;
  cancelCapture: () => Promise<void>;
  addListener: (listener: (event: RppgNativeEvent) => void) => () => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('healthgraph-rppg') as {
      startCapture?: (options: RppgCaptureOptions) => Promise<RppgCaptureResult>;
      cancelCapture?: () => Promise<void>;
      addRppgStateListener?: (listener: (event: RppgNativeEvent) => void) => () => void;
    };
    if (!mod || typeof mod.startCapture !== 'function') return null;
    return {
      startCapture: (options) => mod.startCapture!(options),
      cancelCapture: () => mod.cancelCapture!(),
      addListener: (listener) =>
        typeof mod.addRppgStateListener === 'function'
          ? mod.addRppgStateListener(listener)
          : () => {},
    };
  } catch {
    return null;
  }
}

export function createRppgFrameSource(deps: RppgFrameSourceDeps = {}): RppgFrameSource {
  const native = deps.startCapture ? null : loadNative();
  const available =
    deps.isAvailable ?? (deps.startCapture ? true : native !== null);
  const startCapture =
    deps.startCapture ??
    native?.startCapture ??
    ((_options: RppgCaptureOptions) =>
      Promise.reject(
        new Error(
          '[rppg] face capture is unavailable in this runtime. ' +
            'Use a custom dev/production build with the HealthGraphRPPG native module.',
        ),
      ));
  const cancelCapture = deps.cancelCapture ?? native?.cancelCapture ?? (() => Promise.resolve());
  const addNativeListener = deps.addListener ?? native?.addListener ?? (() => () => {});
  return {
    kind: available ? 'native' : 'unavailable',
    isAvailable: available,
    capture: (options) => startCapture(options ?? {}),
    cancel: () => cancelCapture(),
    addListener: (listener) => addNativeListener(listener),
  };
}

let cached: RppgFrameSource | null = null;

/** Select the usable frame source for this runtime (cached). */
export function getRppgFrameSource(): RppgFrameSource {
  if (!cached) cached = createRppgFrameSource();
  return cached;
}

/** Test seam: reset the cached selection. */
export function __resetRppgFrameSourceForTests(): void {
  cached = null;
}
