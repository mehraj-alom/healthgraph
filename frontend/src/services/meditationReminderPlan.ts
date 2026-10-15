/**
 * meditationReminderPlan.ts — daily practice-nudge pure contract.
 *
 * A practice reminder is a daily nudge at a fixed clock time, not a smart
 * alarm: no streak math, no adaptive scheduling, no claims. Times validate
 * strictly; stored states normalize defensively (corrupt or out-of-range
 * stored values resolve to off, never to a surprise alarm).
 *
 * Zero imports: safe for node unit tests.
 */

export interface MeditationReminderState {
  enabled: boolean;
  hour: number;
  minute: number;
}

/** AsyncStorage key (versioned; single writer is meditationReminders.ts). */
export const MEDITATION_REMINDER_STORAGE_KEY = 'hg:meditation-reminder:v1';

/** Sensible default: 08:00, off until the user opts in. */
export const DEFAULT_MEDITATION_REMINDER_TIME = { hour: 8, minute: 0 } as const;

export function validateMeditationReminderTime(
  hour: unknown,
  minute: unknown,
): { ok: boolean } {
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
export function normalizeMeditationReminderState(
  raw: unknown,
): MeditationReminderState {
  const fallback: MeditationReminderState = {
    enabled: false,
    ...DEFAULT_MEDITATION_REMINDER_TIME,
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return fallback;
  if (!validateMeditationReminderTime(r.hour, r.minute).ok) return fallback;
  return { enabled: true, hour: r.hour as number, minute: r.minute as number };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** One-line status for the Meditation screen — descriptive, promise-free. */
export function describeMeditationReminder(state: MeditationReminderState): string {
  if (!state.enabled) return 'Practice reminder off.';
  return `Practice reminder daily at ${pad(state.hour)}:${pad(state.minute)}.`;
}
