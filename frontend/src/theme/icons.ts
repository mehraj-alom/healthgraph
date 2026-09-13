/**
 * HealthGraph icon language.
 *
 * The app ships without a vector icon library. Rather than add a dependency
 * this increment defines one coherent icon vocabulary built from a tiny set
 * of unicode glyphs + emoji, mapped to health categories. These map directly
 * to the health-agnostic glyphs future screens will use.
 */

export type HealthCategoryKey =
  | 'sleep'
  | 'water'
  | 'hydration'
  | 'stress'
  | 'energy'
  | 'activity'
  | 'heart'
  | 'heartRate'
  | 'hrv'
  | 'medication'
  | 'symptoms'
  | 'vitals'
  | 'nutrition'
  | 'mood'
  | 'wellbeing'
  | 'body'
  | 'documents'
  | 'timeline'
  | 'trends'
  | 'general';

/** Emoji glyph for a given health category (no icon dependency). */
export const healthIcon: Record<HealthCategoryKey, string> = {
  sleep: '🌙',
  water: '💧',
  hydration: '💧',
  stress: '🧘',
  energy: '⚡',
  activity: '👟',
  heart: '❤️',
  heartRate: '❤️',
  hrv: '📶',
  medication: '💊',
  symptoms: '⚠️',
  vitals: '📈',
  nutrition: '🥗',
  mood: '😊',
  wellbeing: '🌱',
  body: '🫂',
  documents: '📄',
  timeline: '🕘',
  trends: '📊',
  general: '●',
};

/** Accessible label for a category, for screen readers and status text. */
export const healthIconLabel: Record<HealthCategoryKey, string> = {
  sleep: 'Sleep',
  water: 'Water',
  hydration: 'Hydration',
  stress: 'Stress',
  energy: 'Energy',
  activity: 'Activity',
  heart: 'Heart',
  heartRate: 'Heart rate',
  hrv: 'Heart rate variability',
  medication: 'Medication',
  symptoms: 'Symptoms',
  vitals: 'Vitals',
  nutrition: 'Nutrition',
  mood: 'Mood',
  wellbeing: 'Wellbeing',
  body: 'Body',
  documents: 'Documents',
  timeline: 'Timeline',
  trends: 'Trends',
  general: 'Health',
};

/** Map a category color token (from theme.health) to its icon key. */
export function iconForCategory(category: string): string {
  const key = category.toLowerCase().replace(/\s+/g, '');
  const map: Record<string, HealthCategoryKey> = {
    sleep: 'sleep',
    water: 'water',
    hydration: 'water',
    stress: 'stress',
    energy: 'energy',
    activity: 'activity',
    heart: 'heart',
    heartrate: 'heartRate',
    hrv: 'hrv',
    medication: 'medication',
    symptom: 'symptoms',
    symptoms: 'symptoms',
    vitals: 'vitals',
    nutrition: 'nutrition',
    food: 'nutrition',
    mood: 'mood',
    wellbeing: 'wellbeing',
    mental: 'wellbeing',
    body: 'body',
    bodyregion: 'body',
    doc: 'documents',
    document: 'documents',
    record: 'documents',
  };
  return healthIcon[map[key] ?? 'general'];
}