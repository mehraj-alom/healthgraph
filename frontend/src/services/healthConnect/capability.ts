/**
 * capability.ts — native-adapter boundary (Slice 1).
 *
 * The Health Connect native adapter is NOT installed yet, so the only
 * adapter that exists reports itself unavailable. The import gate in
 * consent.ts refuses to run without a ready adapter, which means Slice 1
 * can never move health data — by construction, not by convention.
 */

import type { HcDataType } from './records';

/** Minimum data types the import will ever request (Slice 2 scope). */
export const REQUESTED_DATA_TYPES: HcDataType[] = ['steps', 'sleep', 'exercise', 'weight', 'distance'];

/**
 * Data types Slice 3 actually imports: sleep + exercise + weight + steps.
 * Weight needs the resolved server concept UUID (see conceptResolver);
 * steps land in the device-only step_counts table.
 */
export const IMPORTED_DATA_TYPES: ('sleep' | 'exercise' | 'weight' | 'steps')[] = [
  'sleep',
  'exercise',
  'weight',
  'steps',
];

export interface HealthConnectAdapter {
  isAvailable: () => boolean;
  reason: string | null;
}

export const UNAVAILABLE_REASON = 'native-adapter-not-installed';

export const unavailableAdapter: HealthConnectAdapter = {
  isAvailable: () => false,
  reason: UNAVAILABLE_REASON,
};
