/**
 * nutritionEngine.ts — Nutrition Engine pure contract (Batch 6F).
 *
 * Built ONLY from persisted group-level fields: meals_count (user-logged
 * meal counts), calories_kcal (food-scan AI estimates summed per day —
 * never measured, never user-entered on this device), and food_label
 * ("<Type> — <items>" segments, "; "-separated). A meal classification is
 * distribution data, never a nutrient measurement.
 *
 * Rules:
 * - meal counts sum; calorie sums and averages use days WITH a value;
 * - averages divide over days with the measurement, never over all days;
 * - missing stays missing (null, never zero);
 * - period comparison mirrors the shared changes.ts contract
 *   (parity-tested); the logic is inlined because node-tested pure
 *   modules keep zero imports.
 *
 * Deliberately absent from THIS group-level contract: fiber, sugar,
 * sodium, micronutrients, adequacy judgments, diet ratings, nutrient-gap
 * inference, predictions, and any composite headline number. Macros and
 * user-owned targets live in the sibling macroTargets module (scan sums +
 * device-only goals). Copy is descriptive counts only — never healthy or
 * unhealthy, never causal.
 *
 * The meal-type list intentionally duplicates FoodScan/mealTypes (import
 * specifiers cannot satisfy Metro and node at once); a drift test in
 * batch6f pins equality.
 *
 * Zero imports: safe for node unit tests.
 */

/** The Batch 6A engine id that activates this engine. */
export const NUTRITION_ENGINE_ID = 'nutrition';

/** Bounded history window the engine reads (trailing days, inclusive). */
export const NUTRITION_HISTORY_DAYS = 28;

/** Meal classifications (mirrors FoodScan/mealTypes — drift-pinned). */
export const NUTRITION_MEAL_TYPES = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Beverage',
  'Alcohol',
  'Other',
] as const;

export type NutritionMealType = (typeof NUTRITION_MEAL_TYPES)[number];

/** True when the Nutrition Engine is selected in the Batch 6A system. */
export function isNutritionEngineActive(activeEngineIds: readonly string[]): boolean {
  return activeEngineIds.includes(NUTRITION_ENGINE_ID);
}

/** One day with at least one logged nutrition field. */
export interface NutritionDay {
  date: string;
  meals: number | null;
  kcal: number | null;
  label: string | null;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Earliest date (inclusive) of a trailing-N-day window ending todayKey. */
export function nutritionWindowStart(todayKey: string, days: number = NUTRITION_HISTORY_DAYS): string {
  return shiftDayKey(todayKey, -(days - 1));
}

/** Days in the trailing 7 days (inclusive). */
export function trailingWeekDays(days: readonly NutritionDay[], todayKey: string): NutritionDay[] {
  const start = shiftDayKey(todayKey, -6);
  return days.filter((d) => {
    const day = d.date.slice(0, 10);
    return day >= start && day <= todayKey;
  });
}

/** Days in the prior 7 days (comparison baseline). */
export function priorWeekDays(days: readonly NutritionDay[], todayKey: string): NutritionDay[] {
  const start = shiftDayKey(todayKey, -13);
  const end = shiftDayKey(todayKey, -7);
  return days.filter((d) => {
    const day = d.date.slice(0, 10);
    return day >= start && day <= end;
  });
}

/**
 * Classified-meal counts from food labels: each "; "-separated segment
 * contributes to its "<Type>" bucket only with a valid prefix; anything
 * else counts as unclassified (reported, never forced into a type).
 */
export function parseMealTypes(days: readonly NutritionDay[]): {
  byType: Partial<Record<NutritionMealType, number>>;
  classified: number;
  unclassified: number;
} {
  const byType: Partial<Record<NutritionMealType, number>> = {};
  let unclassified = 0;
  for (const d of days) {
    if (!d.label) continue;
    for (const segment of d.label.split(';')) {
      const match = segment.trim().match(/^(.+?) — (.+)$/);
      const type = match?.[1]?.trim() ?? '';
      if ((NUTRITION_MEAL_TYPES as readonly string[]).includes(type)) {
        const key = type as NutritionMealType;
        byType[key] = (byType[key] ?? 0) + 1;
      } else if (segment.trim()) {
        unclassified++;
      }
    }
  }
  const classified = Object.values(byType).reduce((a, b) => a + (b ?? 0), 0);
  return { byType, classified, unclassified };
}

export interface NutritionSummary {
  /** Sum of logged meal counts (rows with a count). */
  mealsLogged: number;
  /** Sum of estimated kcal over days WITH a value; null when none. */
  kcalLogged: number | null;
  /** Days carrying an estimated kcal value (average denominator). */
  kcalDays: number;
  /** Mean estimated kcal over kcalDays; null when kcalDays is 0. */
  avgKcalPerDay: number | null;
  /** Days with any nutrition signal (meals, kcal, or label). */
  activeDays: number;
}

/** Summary over the window; nulls (never zeros) where nothing was logged. */
export function summarizeNutrition(days: readonly NutritionDay[]): NutritionSummary {
  const withMeals = days.filter(
    (d) => typeof d.meals === 'number' && Number.isFinite(d.meals),
  );
  const withKcal = days.filter(
    (d) => typeof d.kcal === 'number' && Number.isFinite(d.kcal),
  );
  const kcalSum = withKcal.reduce((s, d) => s + (d.kcal as number), 0);
  return {
    mealsLogged: withMeals.reduce((s, d) => s + (d.meals as number), 0),
    kcalLogged: withKcal.length > 0 ? kcalSum : null,
    kcalDays: withKcal.length,
    avgKcalPerDay: withKcal.length > 0 ? kcalSum / withKcal.length : null,
    activeDays: days.length,
  };
}

/**
 * Absolute-delta line for logged meal sums, e.g. "+3 meals vs prior
 * week". Null when either week logged no counts. Mirrors
 * changes.describeChange mode 'sum', usePercent false (parity-tested).
 */
export function describeMealsChange(
  current: readonly NutritionDay[],
  previous: readonly NutritionDay[],
  periodLabel = 'vs prior week',
): string | null {
  const sum = (rows: readonly NutritionDay[]): number | null => {
    const counts = rows
      .map((d) => d.meals)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null;
  };
  const cur = sum(current);
  const prev = sum(previous);
  if (cur === null || prev === null) return null;
  const delta = cur - prev;
  if (delta === 0) return `→ 0 meals ${periodLabel}`;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'meal' : 'meals'} ${periodLabel}`;
}

/**
 * Absolute-delta line for estimated kcal sums, e.g. "+320 kcal vs prior
 * week". Null when either week has no estimated value. Mirrors
 * changes.describeChange mode 'sum', usePercent false (parity-tested).
 */
export function describeKcalChange(
  current: readonly NutritionDay[],
  previous: readonly NutritionDay[],
  periodLabel = 'vs prior week',
): string | null {
  const sum = (rows: readonly NutritionDay[]): number | null => {
    const kcals = rows
      .map((d) => d.kcal)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return kcals.length > 0 ? kcals.reduce((a, b) => a + b, 0) : null;
  };
  const cur = sum(current);
  const prev = sum(previous);
  if (cur === null || prev === null) return null;
  const delta = cur - prev;
  const rounded = Math.round(delta);
  if (rounded === 0) return `→ 0 kcal ${periodLabel}`;
  const sign = rounded > 0 ? '+' : '−';
  return `${sign}${Math.abs(rounded)} kcal ${periodLabel}`;
}

/** One cell of the trailing-7-day meals strip. */
export interface NutritionWeekDay {
  date: string;
  meals: number;
}

/** Trailing-7-day per-day logged meal counts (oldest first). */
export function buildNutritionWeek(
  days: readonly NutritionDay[],
  todayKey: string,
): NutritionWeekDay[] {
  const counts = new Map<string, number>();
  for (const d of days) {
    if (typeof d.meals === 'number' && Number.isFinite(d.meals)) {
      const day = d.date.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + d.meals);
    }
  }
  const week: NutritionWeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDayKey(todayKey, -i);
    week.push({ date, meals: counts.get(date) ?? 0 });
  }
  return week;
}

/** "1,840 kcal" — display only, rounded, thousands-separated. */
export function formatKcal(kcal: number): string {
  return `${Math.round(kcal).toLocaleString('en-US')} kcal`;
}
