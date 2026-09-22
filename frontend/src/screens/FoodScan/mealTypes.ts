/**
 * mealTypes.ts — consumption classification for food scans (pure, testable).
 *
 * A scan identifies food; it never creates a meal by itself. The user
 * classifies the consumption (Breakfast … Other) during review, and the
 * classification travels inside the existing food_label pipeline
 * ("<Type> — <items>") — no schema change, no backend change, no invented
 * fields. Zero imports: safe for node unit tests.
 */

export const MEAL_TYPES = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Beverage',
  'Alcohol',
  'Other',
] as const;

export type MealType = (typeof MEAL_TYPES)[number];

/** Suggest a classification from local time-of-day (user can change it). */
export function suggestMealType(now: Date = new Date()): MealType {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'Breakfast';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 17 && h < 22) return 'Dinner';
  return 'Snack';
}

/** True for a known classification id (rejects stale/invented values). */
export function isMealType(value: string | null | undefined): value is MealType {
  return typeof value === 'string' && (MEAL_TYPES as readonly string[]).includes(value);
}

/**
 * Build the persisted food label: "<Type> — <items>". The type prefix is
 * what makes a scan a classified consumption instead of an anonymous meal.
 */
export function formatMealLabel(mealType: MealType, itemsLabel: string): string {
  const items = itemsLabel.trim().slice(0, 200) || 'Scanned meal';
  return `${mealType} — ${items}`.slice(0, 250);
}

/** Strip a previously applied "<Type> — " prefix (re-classification). */
export function stripMealPrefix(label: string): string {
  const match = label.match(/^(.+?) — (.+)$/);
  if (match && isMealType(match[1])) return match[2];
  return label;
}
