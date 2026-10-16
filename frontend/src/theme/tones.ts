/**
 * tones — the category tone system (single source of truth).
 *
 * Canonical duotones originate from the onboarding FocusTile palette:
 * muted, desaturated pairs — one per health dimension. Selection surfaces
 * across the app derive from these tones instead of inventing hues, so a
 * sleep control reads as sleep everywhere.
 *
 * EXTRA_TONES covers non-dimension categories (cycle phases, substances,
 * scan modes) in the same muted duotone language — no bright hues.
 */

/** Canonical per-dimension duotones [deep, soft]. */
export const TILE_TONES = {
  sleep: ['#33325A', '#57507A'],
  weight: ['#36444F', '#5C6E7C'],
  discipline: ['#544653', '#7C6272'],
  fitness: ['#6B4A3A', '#96684A'],
  nutrition: ['#46543A', '#6E7F4E'],
  wellbeing: ['#454550', '#66666F'],
  heart: ['#37605A', '#56837B'],
  meditation: ['#3E3A5C', '#6A6390'],
} as const;

export type ToneKey = keyof typeof TILE_TONES;
export type Tone = readonly [string, string];

/** Extensions for non-dimension categories, same muted language. */
export const EXTRA_TONES = {
  berry: ['#5A2E35', '#8A4A55'],
  slate: ['#3A3F55', '#5A6078'],
  sand: ['#5C5040', '#8A7A5C'],
  pine: ['#2E4A44', '#527A6E'],
} as const;

export type ExtraToneKey = keyof typeof EXTRA_TONES;

/** Health-category → tone (symptoms/pain share the mauve discipline family). */
export function toneForCategory(category: string | undefined | null): Tone {
  switch ((category ?? '').toLowerCase()) {
    case 'sleep':
      return TILE_TONES.sleep;
    case 'weight':
      return TILE_TONES.weight;
    case 'discipline':
      return TILE_TONES.discipline;
    case 'fitness':
    case 'activity':
      return TILE_TONES.fitness;
    case 'nutrition':
    case 'meals':
    case 'food':
      return TILE_TONES.nutrition;
    case 'wellbeing':
    case 'mood':
    case 'energy':
    case 'stress':
      return TILE_TONES.wellbeing;
    case 'heart':
    case 'vital':
    case 'vitals':
      return TILE_TONES.heart;
    case 'symptom':
    case 'symptoms':
    case 'pain':
      return TILE_TONES.discipline;
    case 'medication':
    case 'meds':
      return TILE_TONES.sleep;
    case 'record':
    case 'records':
    case 'observation':
      return TILE_TONES.weight;
    default:
      return TILE_TONES.wellbeing;
  }
}

/** Timeline filter keys → tones (medical_record reads as archive slate). */
export function toneForTimelineFilter(key: string): Tone {
  switch (key) {
    case 'daily_log':
      return TILE_TONES.nutrition;
    case 'symptom':
      return TILE_TONES.wellbeing;
    case 'pain':
      return TILE_TONES.discipline;
    case 'vital':
      return TILE_TONES.heart;
    case 'medication':
      return TILE_TONES.sleep;
    case 'observation':
      return TILE_TONES.weight;
    case 'medical_record':
      return TILE_TONES.weight;
    default:
      return TILE_TONES.wellbeing;
  }
}

/** Append 0–255 alpha to a #RRGGBB hex (for washes on light surfaces). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * Muted graph tone per correlation stream id (tile family, soft stop) —
 * the dark-glass series color. Same hue per feature as Explore tiles.
 */
export function graphToneForStream(id: string): string {
  const base = id
    .replace(/^series-/, '')
    .split(':')[0]
    .toLowerCase();
  switch (base) {
    case 'sleepdur':
    case 'sleepqual':
    case 'awakenings':
    case 'sleep':
      return TILE_TONES.sleep[1];
    case 'energy':
    case 'wellbeing':
      return TILE_TONES.wellbeing[1];
    case 'activity':
    case 'doses':
      return TILE_TONES.fitness[1];
    case 'water':
    case 'meals':
    case 'appetite':
      return TILE_TONES.nutrition[1];
    case 'hr':
    case 'heart':
    case 'vital':
      return TILE_TONES.heart[1];
    case 'stress':
    case 'pain':
    case 'symptom':
      return TILE_TONES.discipline[1];
    case 'weight':
      return TILE_TONES.weight[1];
    default:
      return TILE_TONES.wellbeing[1];
  }
}
