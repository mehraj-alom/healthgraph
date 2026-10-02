/**
 * substanceGoals.ts — goals, streaks, and milestones pure contract.
 *
 * Everything here counts what the user logged — nothing more:
 * drink-equivalents come only from drink-like units (anything else is
 * reported separately, never converted by guessing volumes); streaks count
 * consecutive days without a logged use, and any use today restarts the
 * count. A quit date, when set, anchors the streak instead of open-ended
 * history. Copy stays descriptive progress copy — the banned clinical
 * vocabulary from the test contract never appears in user-facing strings.
 *
 * Zero imports: safe for node unit tests.
 */

export type GoalCategory = 'alcohol' | 'tobacco';
export type GoalMode = 'track' | 'reduce' | 'quit';

export interface SubstanceGoal {
  category: GoalCategory;
  mode: GoalMode;
  weeklyCap?: number;
  quitDate?: string;
}

/** Versioned AsyncStorage key (single writer is substanceGoalStore.ts). */
export const GOALS_STORAGE_KEY = 'hg:substance-goals:v1';

/** Milestone ladder in days (I Am Sober-style, descriptive only). */
export const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOOKBACK_DAYS = 366;

/** Units treated as one drink-equivalent each (anything else: unknown size). */
const DRINK_UNITS = new Set(['drink', 'drinks', 'glass', 'glasses', 'shot', 'shots']);

function dayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDay(dayKey: string, deltaDays: number): string | null {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + deltaDays);
  return dayString(d);
}

function validDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_RE.test(value.slice(0, 10));
}

interface UseEntry {
  occurred_at: unknown;
  category: unknown;
  amount_value: unknown;
  amount_unit: unknown;
}

/**
 * Drink-equivalents for one entry, or null when the unit is not
 * drink-like (unknown-size units are never converted by guessing).
 */
export function drinkEquivalents(entry: Pick<UseEntry, 'amount_value' | 'amount_unit'>): number | null {
  const { amount_value: value, amount_unit: unit } = entry;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
  if (typeof unit !== 'string') return null;
  if (!DRINK_UNITS.has(unit.trim().toLowerCase())) return null;
  return value;
}

export interface WeeklyUse {
  drinks: number;
  otherUnits: number;
  entries: number;
}

/** Trailing-7-day use for one category (inclusive of todayKey). */
export function weeklyUse(
  entries: readonly UseEntry[],
  category: GoalCategory,
  todayKey: string,
): WeeklyUse {
  const start = shiftDay(todayKey, -6);
  const out: WeeklyUse = { drinks: 0, otherUnits: 0, entries: 0 };
  if (start === null) return out;
  for (const e of entries) {
    if (e.category !== category) continue;
    const day = typeof e.occurred_at === 'string' ? e.occurred_at.slice(0, 10) : '';
    if (!DAY_RE.test(day) || day < start || day > todayKey) continue;
    out.entries += 1;
    const eq = drinkEquivalents(e);
    if (eq !== null) out.drinks += eq;
    else if (typeof e.amount_value === 'number' && Number.isFinite(e.amount_value)) {
      out.otherUnits += 1;
    }
  }
  return out;
}

/**
 * Consecutive days without a logged use of the category, counting back
 * from todayKey (capped). Any use today restarts the count at zero. With
 * no history at all and no quit date there is nothing to count: zero, not
 * an invented streak. A quit date anchors the count instead.
 */
export function streakDays(
  entries: readonly UseEntry[],
  category: GoalCategory,
  todayKey: string,
  quitDate?: string,
): number {
  if (!validDay(todayKey)) return 0;
  const usedDays = new Set<string>();
  let hasHistory = false;
  for (const e of entries) {
    if (e.category !== category) continue;
    if (typeof e.occurred_at !== 'string') continue;
    const day = e.occurred_at.slice(0, 10);
    if (!DAY_RE.test(day)) continue;
    const back = shiftDay(todayKey, 0);
    if (back === null) return 0;
    const earliest = shiftDay(todayKey, -(MAX_LOOKBACK_DAYS - 1));
    if (earliest === null) return 0;
    if (day < earliest || day > todayKey) continue;
    hasHistory = true;
    usedDays.add(day);
  }
  let cleanBack = 0;
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const day = shiftDay(todayKey, -i);
    if (day === null || usedDays.has(day)) break;
    cleanBack += 1;
  }
  const quit = typeof quitDate === 'string' && DAY_RE.test(quitDate.slice(0, 10)) ? quitDate.slice(0, 10) : null;
  if (quit !== null && quit <= todayKey) {
    const since = Math.round(
      (new Date(`${todayKey}T12:00:00`).getTime() - new Date(`${quit}T12:00:00`).getTime()) / 86400000,
    );
    return Math.max(0, Math.min(cleanBack, since));
  }
  if (!hasHistory) return 0;
  return cleanBack;
}

/** Reached milestones plus the next one (null when the ladder is done). */
export function milestonesReached(streak: number): { reached: number[]; next: number | null } {
  const reached = MILESTONES.filter((m) => streak >= m);
  const next = MILESTONES.find((m) => streak < m) ?? null;
  return { reached, next };
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Defensive parse of a stored goal: garbage resolves to plain tracking. */
export function normalizeGoal(raw: unknown): SubstanceGoal {
  const fallback: SubstanceGoal = { category: 'alcohol', mode: 'track' };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  if (r.category !== 'alcohol' && r.category !== 'tobacco') return fallback;
  const category: GoalCategory = r.category;
  if (r.mode === 'quit') return { category, mode: 'quit' };
  if (r.mode === 'reduce' && typeof r.weeklyCap === 'number' && Number.isInteger(r.weeklyCap) && r.weeklyCap > 0) {
    const goal: SubstanceGoal = { category, mode: 'reduce', weeklyCap: r.weeklyCap };
    if (typeof r.quitDate === 'string' && DAY_RE.test(r.quitDate.slice(0, 10))) {
      goal.quitDate = r.quitDate.slice(0, 10);
    }
    return goal;
  }
  return { category, mode: 'track' };
}

/** One descriptive status line for the goal card — progress, never judgment. */
export function goalStatusLine(goal: SubstanceGoal, use: WeeklyUse, streak: number): string {
  const dayWord = plural(streak, 'day', 'days');
  if (goal.mode === 'quit') {
    return `${streak} ${dayWord} without logged use`;
  }
  if (goal.mode === 'reduce' && goal.weeklyCap !== undefined) {
    return `${use.drinks} of ${goal.weeklyCap} drinks this week · ${streak} ${dayWord} without logged use`;
  }
  const drinkWord = plural(use.drinks, 'drink', 'drinks');
  const otherWord = plural(use.otherUnits, 'entry', 'entries');
  if (use.otherUnits > 0) {
    return `${use.drinks} ${drinkWord} + ${use.otherUnits} ${otherWord} in other units this week`;
  }
  return `${use.drinks} ${drinkWord} this week`;
}
