/**
 * dayKey — the single canonical calendar-day module (device-local).
 *
 * Every "today" and every day-shift in the app MUST go through here.
 * History: VitalsLogger + Medications once used toISOString() (UTC), so
 * IST logins after midnight wrote "yesterday" while every reader used the
 * local day — entries vanished from today. Five divergent local copies
 * then grew across the codebase; this module reunites them. Pure and
 * node-testable. NEVER use UTC components for calendar days.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local YYYY-MM-DD for a Date (calendar components, never UTC). */
export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local calendar day key. Accepts `now` for deterministic tests. */
export function todayKeyLocal(now: Date = new Date()): string {
  return toDayKey(now);
}

/**
 * Shift a YYYY-MM-DD key by whole days. Noon-anchored so DST transitions
 * (23/25-hour days) cannot slip the calendar date, unlike midnight math.
 * Returns '' for unparseable input (callers treat as missing, never guess).
 */
export function shiftDayKey(dayKey: string, deltaDays: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return '';
  const d = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + deltaDays);
  return toDayKey(d);
}
