/**
 * PPG provider selection.
 *
 * - Custom dev/production build with the native module → native provider.
 * - Expo Go / web / anything without the native module → simulated provider
 *   (clearly marked, never persisted, never synced).
 *
 * Importing this module is safe in every runtime: native-module resolution
 * is lazy and guarded, so Expo Go never crashes on a missing module.
 */

import Constants from 'expo-constants';
import { isPpgAvailable } from 'healthgraph-ppg';
import { nativePpgProvider } from './nativeProvider';
import { simulatedPpgProvider } from './simulatedProvider';
import { unavailablePpgProvider } from './unavailableProvider';
import type { PpgProvider } from './types';

export * from './types';
export { nativePpgProvider } from './nativeProvider';
export { simulatedPpgProvider, SIM_ALGORITHM_VERSION } from './simulatedProvider';
export { unavailablePpgProvider } from './unavailableProvider';
// Value re-exports from the native-module package (stable copy + version).
export { PPG_COPY, PPG_ALGORITHM_VERSION } from 'healthgraph-ppg';

let cached: PpgProvider | null = null;

function runningInExpoGo(): boolean {
  try {
    return Constants?.appOwnership === 'expo';
  } catch {
    return false;
  }
}

/** True inside Expo Go (no custom native modules) — for honest error copy. */
export function isExpoGoPpgRuntime(): boolean {
  return runningInExpoGo();
}

/** Select the usable provider for this runtime (cached). */
export function getPpgProvider(): PpgProvider {
  if (!cached) {
    let useNative = false;
    try {
      useNative = !runningInExpoGo() && isPpgAvailable;
    } catch {
      useNative = false;
    }
    if (useNative) {
      cached = nativePpgProvider;
    } else if (__DEV__) {
      // Development only (Expo Go, dev client without the module, tests):
      // clearly-marked synthetic data, never persisted or synced.
      cached = simulatedPpgProvider;
    } else {
      // Release builds (preview/production) must never silently produce
      // fake measurements: refuse loudly instead.
      cached = unavailablePpgProvider;
    }
  }
  return cached;
}

/** Test seam: reset the cached selection. */
export function __resetPpgProviderForTests(): void {
  cached = null;
}
