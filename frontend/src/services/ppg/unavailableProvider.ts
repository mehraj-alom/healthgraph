/**
 * Unavailable PPG provider — last resort for release builds where the
 * native module is missing (broken link, wrong build type).
 *
 * It refuses every measurement with a clear error instead of silently
 * falling back to synthetic data: fake numbers must never look real in a
 * build a friend could install.
 */

import type {
  PpgMeasureOptions,
  PpgProvider,
  PpgStateEvent,
} from './types';

type Listener = (event: PpgStateEvent) => void;

export const unavailablePpgProvider: PpgProvider = {
  kind: 'native',
  isAvailable: false,

  measure(_options?: PpgMeasureOptions): Promise<never> {
    return Promise.reject(
      new Error(
        'Heart-rate measurement is not available in this build. Please install the latest version of HealthGraph.',
      ),
    );
  },

  cancel(): Promise<void> {
    return Promise.resolve();
  },

  addStateListener(_listener: Listener): () => void {
    return () => {};
  },
};
