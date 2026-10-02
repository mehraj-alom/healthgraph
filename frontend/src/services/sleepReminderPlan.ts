/**
 * sleepReminderPlan.ts — bedtime reminder pure contract.
 *
 * A bedtime reminder is a daily nudge at a fixed clock time, not a smart
 * alarm: no sleep staging, no wake-window math, no claims. Times validate
 * strictly; stored states normalize defensively (corrupt or out-of-range
 * stored values resolve to off, never to a surprise alarm).
 *
 * Zero imports: safe for node unit tests.
 */

export interface SleepReminderState {
  enabled: boolean;
  hour: number;
  minute: number;
}

/** AsyncStorage key (versioned; single writer is sleepReminders.ts). */
export const REMINDER_STORAGE_KEY = 'hg:sleep-reminder:v1';

/** Sensible default: 22:30, off until the user opts in. */
export const DEFAULT_REMINDER_TIME = { hour: 22, minute: 30 } as const;

export function validateReminderTime(hour: unknown, minute: unknown): { ok: boolean } {
  const ok =
    typeof hour === 'number' &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    typeof minute === 'number' &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59;
  return { ok };
}

/** Defensive parse of stored state: anything unexpected means off. */
export function normalizeReminderState(raw: unknown): SleepReminderState {
  const fallback: SleepReminderState = { enabled: false, ...DEFAULT_REMINDER_TIME };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return fallback;
  if (!validateReminderTime(r.hour, r.minute).ok) return fallback;
  return { enabled: true, hour: r.hour as number, minute: r.minute as number };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** One-line status for the Sleep screen — descriptive, promise-free. */
export function describeReminder(state: SleepReminderState): string {
  if (!state.enabled) return 'Bedtime reminder off.';
  return `Bedtime reminder daily at ${pad(state.hour)}:${pad(state.minute)}.`;
}
