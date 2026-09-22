/**
 * engines.ts — goal-driven engine catalog + activation (pure).
 *
 * Engines are product metadata only in this batch (no intelligence yet):
 * stable ids, titles, descriptions, glyphs, and optional destinations on
 * EXISTING routes. Activation derives from the user's stored focus
 * selections (onboarding_state.focus_json) — any combination coexists;
 * there are intentionally no if/else chains per engine.
 *
 * Legacy focus ids from the pre-engine catalog forward-map here so
 * established selections survive the upgrade instead of being dropped.
 * Unknown ids are always dropped (never fabricated). Zero imports.
 */

export const ENGINE_IDS = [
  'sleep',
  'weight',
  'discipline',
  'fitness',
  'nutrition',
  'wellbeing',
  'heart',
] as const;

export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineRoute {
  name: string;
  params?: Record<string, unknown>;
}

export interface EngineDef {
  id: EngineId;
  title: string;
  description: string;
  /** Single text glyph (geometric family, matching timeline markers). */
  glyph: string;
  /** Existing route, or null when no destination exists yet. */
  route: EngineRoute | null;
}

export const ENGINES: Record<EngineId, EngineDef> = {
  sleep: {
    id: 'sleep',
    title: 'Sleep better',
    description: 'Build healthier sleep habits and understand your patterns.',
    glyph: '☾',
    route: { name: 'SleepEngine' },
  },
  weight: {
    id: 'weight',
    title: 'Manage my weight',
    description: 'See your weight as recorded in your profile.',
    glyph: '◔',
    route: { name: 'WeightEngine' },
  },
  discipline: {
    id: 'discipline',
    title: 'Build better discipline',
    description: 'See the health actions you actually keep doing.',
    glyph: '✓',
    route: { name: 'DisciplineEngine' },
  },
  fitness: {
    id: 'fitness',
    title: 'Improve fitness',
    description: 'See your logged activity and exercise minutes.',
    glyph: '▲',
    route: { name: 'FitnessEngine' },
  },
  nutrition: {
    id: 'nutrition',
    title: 'Eat better',
    description: 'See your logged meals and estimated calories.',
    glyph: '■',
    route: { name: 'NutritionEngine' },
  },
  wellbeing: {
    id: 'wellbeing',
    title: 'Manage stress & wellbeing',
    description: 'See your recorded mood, energy, and stress.',
    glyph: '○',
    route: { name: 'WellbeingEngine' },
  },
  heart: {
    id: 'heart',
    title: 'Understand my heart health',
    description: 'See your measured heart rate and HRV.',
    glyph: '♥',
    route: { name: 'HeartEngine' },
  },
};

export function isEngineId(value: unknown): value is EngineId {
  return (
    typeof value === 'string' &&
    (ENGINE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Forward-map for pre-engine focus ids (Batch 1 catalog). Returns null for
 * ids with no engine equivalent (records-clarity) — those are dropped, and
 * dropping is honest: nothing is invented to replace them.
 */
const LEGACY_FOCUS_TO_ENGINE: Record<string, EngineId | null> = {
  'sleep-quality': 'sleep',
  energy: 'wellbeing',
  'stress-calm': 'wellbeing',
  movement: 'fitness',
  'eating-habits': 'nutrition',
  'heart-awareness': 'heart',
  'weight-balance': 'weight',
  'records-clarity': null,
};

export function migrateLegacyFocus(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (isEngineId(id)) {
      if (!out.includes(id)) out.push(id);
      continue;
    }
    const mapped = LEGACY_FOCUS_TO_ENGINE[id] ?? null;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * Sanitize a raw selection list: migrate legacy ids, drop unknowns,
 * dedupe (first wins), cap at catalog size.
 */
export function sanitizeEngineIds(ids: readonly string[] | null | undefined): EngineId[] {
  if (!Array.isArray(ids)) return [];
  const migrated = migrateLegacyFocus(ids);
  return migrated.filter((id): id is EngineId => isEngineId(id)).slice(0, ENGINE_IDS.length);
}

/**
 * THE activation selector: stored selections → active engine definitions.
 * Set-based catalog filter — any combination coexists, no per-engine
 * branches anywhere in the product.
 */
export function deriveActiveEngines(selections: readonly string[]): EngineDef[] {
  const active = new Set(sanitizeEngineIds(selections));
  return ENGINE_IDS.filter((id) => active.has(id)).map((id) => ENGINES[id]);
}

/** Convenience over an onboarding state shape ({ focus } only). */
export function getActiveEngines(state: { focus?: readonly string[] } | null | undefined): EngineDef[] {
  if (!state || !Array.isArray(state.focus)) return [];
  return deriveActiveEngines(state.focus);
}
