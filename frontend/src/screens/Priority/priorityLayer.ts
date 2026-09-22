/**
 * priorityLayer.ts — Priority presentation layer (post-Batch-6).
 *
 * Priority is DERIVED from the Batch 6A activeEngines system — there is
 * no second source of truth, no second selection store, no Priority
 * health metric. Given stored focus ids, this module produces the
 * user-facing Priority: engine entries in catalog order, the empty
 * state, day-specific intro copy, and the three-lifetime-exposure rule.
 *
 * The engine id→title list intentionally duplicates the Batch 6A catalog
 * (import specifiers cannot satisfy Metro and node at once); a drift
 * test in batchPriority pins equality with ENGINES.
 *
 * Copy is descriptive — never medical, never causal, never a score.
 *
 * Zero imports: safe for node unit tests.
 */

/** Lifetime intro exposures: exactly three, then never again. */
export const MAX_PRIORITY_EXPOSURES = 3;

/** Catalog-order engine entries (mirrors the 6A catalog — drift-pinned). */
export const PRIORITY_ENGINES: readonly { id: string; title: string }[] = [
  { id: 'sleep', title: 'Sleep better' },
  { id: 'weight', title: 'Manage my weight' },
  { id: 'discipline', title: 'Build better discipline' },
  { id: 'fitness', title: 'Improve fitness' },
  { id: 'nutrition', title: 'Eat better' },
  { id: 'wellbeing', title: 'Manage stress & wellbeing' },
  { id: 'heart', title: 'Understand my heart health' },
];

const PRIORITY_IDS = new Set(PRIORITY_ENGINES.map((e) => e.id));

export interface PriorityEntry {
  id: string;
  title: string;
}

/**
 * The user-facing Priority: selected engines in catalog order, deduped,
 * unknowns dropped (never fabricated). Empty selection → empty list (the
 * caller renders the honest empty state, never a placeholder).
 */
export function buildPriority(focusIds: readonly string[] | null | undefined): PriorityEntry[] {
  if (!Array.isArray(focusIds)) return [];
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const id of focusIds) {
    if (typeof id !== 'string' || seen.has(id) || !PRIORITY_IDS.has(id)) continue;
    seen.add(id);
    selected.push(id);
  }
  const order = new Map(PRIORITY_ENGINES.map((e, i) => [e.id, i] as const));
  return selected
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map((id) => ({ id, title: PRIORITY_ENGINES.find((e) => e.id === id)?.title ?? id }));
}

/** "Sleep · Nutrition · Fitness" — compact single-line form. */
export function formatPriorityNames(entries: readonly PriorityEntry[]): string {
  return entries.map((e) => e.title).join(' · ');
}

export interface IntroEligibility {
  /** Setup completed (fresh or grandfathered). */
  completed: boolean;
  /** Lifetime exposures already shown (0–3). */
  count: number;
  /** Local calendar day of the last exposure, or null. */
  lastDate: string | null;
  /** Local calendar day today (YYYY-MM-DD). */
  today: string;
}

/**
 * Show the intro card exactly once per calendar day for the first three
 * eligible days: completed setup, fewer than three lifetime exposures,
 * and nothing shown yet today. Navigation, restarts, and priority edits
 * never reset the counter — only a new calendar day re-opens the gate,
 * and only until the third exposure.
 */
export function shouldShowPriorityIntro(input: IntroEligibility): boolean {
  if (!input.completed) return false;
  if (input.count >= MAX_PRIORITY_EXPOSURES) return false;
  if (input.lastDate === input.today) return false;
  return true;
}

/** Exposure day number about to be shown (1, 2, or 3). */
export function introDayNumber(count: number): 1 | 2 | 3 {
  if (count <= 0) return 1;
  if (count === 1) return 2;
  return 3;
}

export interface IntroCopy {
  headline: string;
  body: string;
  cta: string;
}

/** Day-specific intro copy — a progression, never a repeated popup. */
export function introCopy(day: 1 | 2 | 3): IntroCopy {
  switch (day) {
    case 1:
      return {
        headline: 'Your priorities are set',
        body: "We'll keep these areas together so you can see what you're focusing on.",
        cta: 'View my priorities',
      };
    case 2:
      return {
        headline: 'Your priorities',
        body: 'Your selected areas are always available from your profile.',
        cta: 'View priorities',
      };
    case 3:
      return {
        headline: 'Your priorities are here',
        body: 'Change them anytime from your profile.',
        cta: 'View my priorities',
      };
  }
}
