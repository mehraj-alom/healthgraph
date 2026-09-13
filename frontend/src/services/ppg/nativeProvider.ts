/**
 * Native PPG provider — thin wrapper over the HealthGraphPPG Expo module.
 * Used only in custom dev/production builds where the native module exists.
 */

import {
  addPpgStateListener,
  cancelMeasure,
  isPpgAvailable,
  measure,
} from 'healthgraph-ppg';
import type { PpgProvider } from './types';

export const nativePpgProvider: PpgProvider = {
  kind: 'native',
  isAvailable: isPpgAvailable,
  measure: (options) => measure(options ?? {}),
  cancel: () => cancelMeasure(),
  addStateListener: (listener) => addPpgStateListener(listener),
};
