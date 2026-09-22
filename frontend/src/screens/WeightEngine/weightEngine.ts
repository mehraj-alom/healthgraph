/**
 * weightEngine.ts — Weight Management Engine pure contract (Batch 6C).
 *
 * The audit found exactly ONE real weight source: the server profile
 * snapshot cached on device (profile_cache.weight_kg, edited in Settings).
 * There is no weight time series, no vital entries, no body-mass
 * classification, no body composition, no wearable input — so this engine
 * is deliberately a shell:
 *
 * - current profile weight display (value + unit + provenance, no date:
 *   a profile field has no measurement date and must never claim one);
 * - honest empty state when no profile weight is set;
 * - an explicit refusal to compute trends/changes: a single profile value
 *   has no baseline, and a trend from one point would be fabrication.
 *
 * There are intentionally NO period constants (7/28/90 days), NO change
 * helpers, and NO target/prediction math in this module. When weight
 * logging exists, trend work reuses the shared changes.ts contract — the
 * same arrangement as the Sleep Engine. Copy is descriptive, never
 * causal ("while", never "because") and never medical.
 *
 * Zero imports: safe for node unit tests.
 */

/** The Batch 6A engine id that activates this engine. */
export const WEIGHT_ENGINE_ID = 'weight';

/** True when the Weight Engine is selected in the Batch 6A engine system. */
export function isWeightEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(WEIGHT_ENGINE_ID);
}

/**
 * A real recorded weight: kilograms as stored, or null when the profile
 * carries no weight. Non-finite and non-positive values are treated as
 * absent — a profile field is not a measurement, and a bad value must
 * render as no-data, never as "0 kg".
 */
export function sanitizeProfileWeight(weightKg: unknown): number | null {
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg)) return null;
  if (weightKg <= 0 || weightKg >= 500) return null;
  return weightKg;
}

/** "72.5 kg" — display only, one decimal, no rounding of stored values. */
export function formatWeightKg(weightKg: number): string {
  const rounded = Math.round(weightKg * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : String(rounded)} kg`;
}

export interface WeightEngineModel {
  /** Real profile weight, or null when none is recorded. */
  weightKg: number | null;
  /** Provenance line shown under the value (never a date claim). */
  provenance: string;
}

/** Engine model from a raw profile value; null-safe throughout. */
export function buildWeightEngineModel(profileWeightKg: unknown): WeightEngineModel {
  return {
    weightKg: sanitizeProfileWeight(profileWeightKg),
    provenance: 'From your profile',
  };
}
