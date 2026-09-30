/**
 * macroTargets.ts — user-owned calorie/macro targets (pure, zero imports).
 *
 * Targets are goals the user sets, never prescriptions: the suggester
 * offers a starting point from profile data and the user edits everything.
 * Copy rules (pinned by batch6f tests): no "recommended", no deficit
 * framing, no predictions, no diagnoses, no rated-number wording anywhere
 * near the engine. Node-testable.
 */

/** Direction the user chooses for their own intake goal. */
export type IntakeGoal = 'lose' | 'maintain' | 'gain';

/** Activity range the user picks (Mifflin-St Jeor multipliers). */
export type ActivityBand = 'light' | 'moderate' | 'active' | 'very-active';

export const ACTIVITY_FACTOR: Record<ActivityBand, number> = {
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9,
};

/** Daily targets, all user-editable. Null = not set yet. */
export interface MacroTargets {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface TargetInputs {
  weightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  /** 'female' | 'male' | null — null falls back to the midpoint. */
  sex: 'female' | 'male' | null;
  goal: IntakeGoal;
  activity: ActivityBand;
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Starting-point targets from profile data. Mifflin-St Jeor when age and
 * sex are known, otherwise a weight-based estimate (22 kcal/kg baseline
 * labelled as such by callers). Goal adjusts intake (-500/0/+300) with a
 * 1400 kcal floor. Protein scales with goal (2.0/1.8/1.6 g per kg);
 * fat takes 25% of calories; carbs fill the remainder. All rounded.
 * Returns nulls when weight is unknown — nothing to base it on.
 */
export function suggestTargets(input: TargetInputs): MacroTargets {
  const { weightKg, heightCm, ageYears, sex, goal, activity } = input;
  if (!finite(weightKg)) {
    return { calories: null, protein: null, carbs: null, fat: null };
  }
  const weight = weightKg as number;
  let bmr: number;
  if (finite(heightCm) && finite(ageYears) && (sex === 'female' || sex === 'male')) {
    const s = sex === 'male' ? 5 : -161;
    bmr = 10 * weight + 6.25 * (heightCm as number) + s - 5 * (ageYears as number);
  } else {
    bmr = 22 * weight;
  }
  const tdee = bmr * (ACTIVITY_FACTOR[activity] ?? ACTIVITY_FACTOR.moderate);
  const adjust = goal === 'lose' ? -500 : goal === 'gain' ? 300 : 0;
  const calories = Math.max(1400, Math.round((tdee + adjust) / 10) * 10);
  const proteinPerKg = goal === 'lose' ? 2.0 : goal === 'gain' ? 1.6 : 1.8;
  const protein = Math.round(proteinPerKg * weight);
  const fat = Math.round(((calories * 0.25) / 9) * 2) / 2;
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { calories, protein, carbs, fat };
}

/** One nutrient's day progress against its target. Null when either is missing. */
export interface NutrientProgress {
  actual: number;
  target: number;
  /** 0-1+ (uncapped so over-target renders full + overflow). */
  ratio: number;
  remaining: number;
}

export function nutrientProgress(
  actual: number | null | undefined,
  target: number | null | undefined,
): NutrientProgress | null {
  if (actual == null || target == null) return null;
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0 || actual < 0) return null;
  return { actual, target, ratio: actual / target, remaining: target - actual };
}

/** Day sums built from scan breakdowns (kcal + P/C/F grams). */
export interface DayMacros {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** True when the day's calories landed within ±15% of target. */
export function isOnTargetDay(day: Pick<DayMacros, 'kcal'>, targetKcal: number | null): boolean {
  if (targetKcal == null || !Number.isFinite(targetKcal) || targetKcal <= 0) return false;
  if (!Number.isFinite(day.kcal) || day.kcal < 0) return false;
  return Math.abs(day.kcal - targetKcal) / targetKcal <= 0.15;
}

/** On-target days out of days carrying any intake data (null when none). */
export function weekOnTarget(
  days: readonly Pick<DayMacros, 'date' | 'kcal'>[],
  targetKcal: number | null,
): { onTarget: number; withData: number } | null {
  const withData = days.filter((d) => Number.isFinite(d.kcal) && d.kcal > 0);
  if (withData.length === 0 || targetKcal == null) return null;
  return {
    onTarget: withData.filter((d) => isOnTargetDay(d, targetKcal)).length,
    withData: withData.length,
  };
}

/** "1,840" — display only. */
export function formatGrams(g: number): string {
  return `${Math.round(g).toLocaleString('en-US')}g`;
}
