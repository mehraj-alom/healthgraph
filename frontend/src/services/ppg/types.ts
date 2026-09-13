/**
 * PPG provider boundary.
 *
 * Screens and hooks depend ONLY on this interface — never on the native
 * module directly. Two implementations exist behind it:
 *
 * - native:    the HealthGraphPPG Expo module (custom dev/production build)
 * - simulated: deterministic synthetic signal through the REAL on-device
 *              pipeline (`processPpgSignal`), for Expo Go / web development.
 *              Simulated results are NOT real measurements: they are never
 *              persisted, never synced, and must be badged as SIMULATION.
 */

import type {
  PpgMeasurementResult,
  PpgMeasureOptions,
  PpgStateEvent,
} from 'healthgraph-ppg';

export type {
  PpgMeasurementResult,
  PpgMeasureOptions,
  PpgState,
  PpgStateEvent,
} from 'healthgraph-ppg';

export type PpgProviderKind = 'native' | 'simulated';

export interface PpgProvider {
  readonly kind: PpgProviderKind;
  /** Whether this provider can run in the current runtime. */
  readonly isAvailable: boolean;
  measure(options?: PpgMeasureOptions): Promise<PpgMeasurementResult>;
  cancel(): Promise<void>;
  addStateListener(
    listener: (event: PpgStateEvent) => void,
  ): () => void;
}
