/**
 * healthConnect/index.ts — public surface of the Slice 1 foundation.
 */
export type { HcDataType, HcSleepSessionInput, HcWeightInput, HcExerciseSessionInput, HcStepsInput } from './records';
export {
  REQUESTED_DATA_TYPES,
  UNAVAILABLE_REASON,
  unavailableAdapter,
  type HealthConnectAdapter,
} from './capability';
export {
  CONSENT_STORAGE_KEY,
  CONSENT_TEXT_VERSION,
  canImport,
  grantConsent,
  readConsent,
  revokeConsent,
  type ConsentRecord,
  type ConsentStoragePort,
} from './consent';
export { DISCLOSURE_BODY, DISCLOSURE_TITLE } from './disclosure';
export { clearConceptCache, resolveWeightConceptId } from './conceptResolver';
export {
  dedupeKey,
  mapExerciseSession,
  mapSleepSession,
  mapStepsRecord,
  mapWeightRecord,
  type ActivityFragment,
  type SleepFragment,
  type StepsFragment,
  type WeightFragment,
} from './mapping';
