/**
 * substancePledge.ts — daily pledge + savings calculator pure contract.
 *
 * A pledge is one row per category per day (day + optional reason).
 * Pledge streaks count consecutive pledged days with one day of grace
 * for today-in-progress; gaps break, future days and other categories
 * never count. Savings multiply a user-entered typical spend by days
 * since an anchor day (quit date, else first pledge) — no anchor or no
 * spend yields null, never an invented total. Copy stays descriptive.
 *
 * Zero imports: safe for node unit tests.
 */

export type PledgeCategory = 'alcohol' | 'tobacco';

/** Versioned AsyncStorage keys (single writer is substancePledgeStore.ts). */
export const PLEDGE_STORAGE_KEY = 'hg:substance-pledges:v1';
export const SAVINGS_STORAGE_KEY = 'hg:substance-savings:v1';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface Pledge {
  category: string;
  day: string;
  reason: string | null;
}

export interface NormalizedPledge {
  category: PledgeCategory;
  day: string;
  reason: string | null;
}

function cleanText(value: unknown, max: number): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Validate a pledge (throws on bad category/day, never stores). */
export function normalizePledge(input: {
  category: unknown;
  day: unknown;
  reason?: unknown;
}): NormalizedPledge {
  if (input.category !== 'alcohol' && input.category !== 'tobacco') {
    throw new Error('Choose alcohol or tobacco.');
  }
  const day = typeof input.day === 'string' ? input.day.slice(0, 10) : '';
  if (!DAY_RE.test(day)) {
    throw new Error('A valid day (YYYY-MM-DD) is required.');
  }
  return { category: input.category, day, reason: cleanText(input.reason, 280) };
}

function shiftDay(dayKey: string, deltaDays: number): string | null {
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pledged days for one category, capped at today. */
function pledgedDays(pledges: ReadonlyArray<Pledge>, category: PledgeCategory, todayKey: string): Set<string> {
  const out = new Set<string>();
  if (!DAY_RE.test(todayKey.slice(0, 10))) return out;
  const today = todayKey.slice(0, 10);
  for (const p of pledges) {
    if (p.category !== category || typeof p.day !== 'string') continue;
    const day = p.day.slice(0, 10);
    if (!DAY_RE.test(day) || day > today) continue;
    out.add(day);
  }
  return out;
}

/**
 * Consecutive pledged days with one day of grace for today-in-progress:
 * counts back from today, or from yesterday when today is unpledged.
 */
export function pledgeStreak(
  pledges: ReadonlyArray<Pledge>,
  category: PledgeCategory,
  todayKey: string,
): number {
  const days = pledgedDays(pledges, category, todayKey);
  if (days.size === 0) return 0;
  const today = todayKey.slice(0, 10);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let streak = 0;
  while (cursor !== null && days.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

/** True when the category is pledged for todayKey. */
export function hasPledgedToday(
  pledges: ReadonlyArray<Pledge>,
  category: PledgeCategory,
  todayKey: string,
): boolean {
  return pledgedDays(pledges, category, todayKey).has(todayKey.slice(0, 10));
}

export interface SavingsPlan {
  category: PledgeCategory;
  amountPerDay: number;
  currency: string;
}

/** Validate a savings plan (throws on bad spend, never stores). */
export function normalizeSavingsPlan(input: {
  category: unknown;
  amountPerDay: unknown;
  currency?: unknown;
}): SavingsPlan {
  if (input.category !== 'alcohol' && input.category !== 'tobacco') {
    throw new Error('Choose alcohol or tobacco.');
  }
  const amount = input.amountPerDay;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    throw new Error('Enter a typical spend per day above zero.');
  }
  const currency = cleanText(input.currency, 8) ?? '$';
  return { category: input.category, amountPerDay: amount, currency };
}

export interface SavingsSummary {
  days: number;
  total: number;
}

/**
 * Days × spend since the anchor day (quit date, else first pledge day).
 * Null without an anchor, without spend, or when the anchor is future —
 * never an invented total.
 */
export function savingsSince(
  anchorDay: string | null | undefined,
  amountPerDay: number | null | undefined,
  todayKey: string,
): SavingsSummary | null {
  const anchor = typeof anchorDay === 'string' ? anchorDay.slice(0, 10) : '';
  const today = typeof todayKey === 'string' ? todayKey.slice(0, 10) : '';
  if (!DAY_RE.test(anchor) || !DAY_RE.test(today) || anchor > today) return null;
  if (typeof amountPerDay !== 'number' || !Number.isFinite(amountPerDay) || amountPerDay <= 0) return null;
  const days = Math.round(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${anchor}T12:00:00`).getTime()) / 86400000,
  );
  if (days < 0) return null;
  return { days, total: Math.round(days * amountPerDay * 100) / 100 };
}

/** One descriptive savings line — amounts with their window, never judgment. */
export function savingsStatusLine(summary: SavingsSummary | null, currency: string): string {
  if (summary === null) return 'Add your typical spend to see savings';
  const dayWord = summary.days === 1 ? 'day' : 'days';
  return `≈ ${currency}${summary.total.toFixed(2)} not spent · ${summary.days} ${dayWord}`;
}
