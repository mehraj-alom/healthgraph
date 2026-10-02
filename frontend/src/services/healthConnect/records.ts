/**
 * records.ts — Health Connect record input shapes (Slice 1).
 *
 * Fields are `unknown` on purpose: external records are validated in
 * mapping.ts, never trusted. No native imports — pure TypeScript.
 */

export type HcDataType = 'steps' | 'sleep' | 'exercise' | 'weight';

export interface HcSleepSessionInput {
  uid: unknown;
  startTime: unknown;
  endTime: unknown;
}

export interface HcWeightInput {
  uid: unknown;
  time: unknown;
  weightKg: unknown;
  weightLb: unknown;
}

export interface HcExerciseSessionInput {
  uid: unknown;
  startTime: unknown;
  endTime: unknown;
  exerciseType: unknown;
  activeCaloriesKcal: unknown;
}

export interface HcStepsInput {
  uid: unknown;
  startTime: unknown;
  endTime: unknown;
  steps: unknown;
}
