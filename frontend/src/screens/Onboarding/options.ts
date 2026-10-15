/**
 * options.ts — onboarding personalization catalog (pure, testable).
 *
 * Stable ids are persisted in SQLite; labels/hints are presentation only.
 * Goals and focus areas use neutral wellness language — selections are
 * preferences, never diagnoses. Unknown ids are dropped on read so a
 * future catalog change can never break stored rows.
 */

export interface OnboardingOption {
  id: string;
  label: string;
  hint: string;
}

export const HEALTH_GOALS: readonly OnboardingOption[] = [
  { id: 'sleep', label: 'Improve sleep', hint: 'Fall asleep easier, wake rested' },
  { id: 'fitness', label: 'Improve fitness', hint: 'Move more, build stamina' },
  { id: 'weight', label: 'Manage weight', hint: 'Steady, sustainable balance' },
  { id: 'nutrition', label: 'Improve nutrition', hint: 'Eat well, feel the difference' },
  { id: 'heart', label: 'Monitor heart metrics', hint: 'Keep an eye on your pulse' },
  { id: 'wellbeing', label: 'Improve wellbeing', hint: 'Energy, mood and calm' },
  { id: 'meditation', label: 'Practice meditation', hint: 'Sit regularly, build a habit' },
  { id: 'history', label: 'Understand medical history', hint: 'Organize records clearly' },
];

/**
 * Focus areas ARE the engine catalog (Batch 6A): selecting focus activates
 * engines. Kept import-free (node-testable); equality with engines.ts is
 * pinned by batch6a tests, so the selectable set can never drift from the
 * activation set. Legacy pre-engine ids forward-map via migrateLegacyFocus
 * before sanitizing (see useOnboardingState).
 */
export const FOCUS_AREAS: readonly OnboardingOption[] = [
  { id: 'sleep', label: 'Sleep better', hint: 'Build healthier sleep habits and understand your patterns.' },
  { id: 'weight', label: 'Manage my weight', hint: 'See your weight as recorded in your profile.' },
  { id: 'discipline', label: 'Build better discipline', hint: 'See the health actions you actually keep doing.' },
  { id: 'fitness', label: 'Improve fitness', hint: 'See your logged activity and exercise minutes.' },
  { id: 'nutrition', label: 'Eat better', hint: 'See your logged meals and estimated calories.' },
  { id: 'wellbeing', label: 'Manage stress & wellbeing', hint: 'See your recorded mood, energy, and stress.' },
  { id: 'heart', label: 'Understand my heart health', hint: 'See your measured heart rate and HRV.' },
  { id: 'meditation', label: 'Practice meditation', hint: 'Time your sits and review your practice.' },
];

/**
 * Sanitize a selection list: drop unknowns/non-strings, dedupe (first wins),
 * cap length. Pure — shared by the UI and the persistence layer.
 */
export function sanitizeSelections(
  ids: readonly string[] | null | undefined,
  allowed: readonly OnboardingOption[],
  max = 8,
): string[] {
  if (!Array.isArray(ids)) return [];
  const valid = new Set(allowed.map((o) => o.id));
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (!valid.has(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}
