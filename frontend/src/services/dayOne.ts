/**
 * dayOne.ts — day-one starter strip logic (slice C).
 *
 * Pure visibility rules over real signals: the strip shows until the
 * three setups are done (daily call booked, medication reminders on,
 * today's reflection exists). The medication row never asks for
 * reminders before a medication exists — no permission begging on a
 * blank install. The voice-journal row counts as done once today is
 * reflected anywhere: journal transcripts append to the day's notes,
 * so a logged today means today's reflection exists.
 *
 * Node-testable by design: rules are pure over explicit signals; the
 * dismiss flag lives behind a lazy store wrapper (production only).
 */

export const DAY_ONE_DISMISS_KEY = 'hg:day-one-dismissed:v1';

export interface DayOneSignals {
  loggedToday: boolean;
  medCount: number;
  remindersOn: boolean;
  callEnabled: boolean;
  callTime: string | null;
  journalCount?: number;
}

export type DayOneItemId = 'checkin-call' | 'med-reminders' | 'voice-journal';

export interface DayOneItem {
  id: DayOneItemId;
  done: boolean;
  status: string;
}

/** The three starter rows with done flags and plain status lines. Pure. */
export function dayOneItems(s: DayOneSignals): DayOneItem[] {
  const hasMeds = s.medCount > 0;
  const journalDone = s.loggedToday || (s.journalCount ?? 0) > 0;
  return [
    {
      id: 'checkin-call',
      done: s.callEnabled,
      status:
        s.callEnabled && s.callTime ? `On · ${s.callTime}` : 'Pick a time for your daily call',
    },
    {
      id: 'med-reminders',
      done: hasMeds && s.remindersOn,
      status: !hasMeds
        ? 'Add your first medication'
        : s.remindersOn
          ? 'Reminders on'
          : 'Reminders are off',
    },
    {
      id: 'voice-journal',
      done: journalDone,
      status: journalDone ? 'Today is reflected' : 'Talk through your day, kept on this device',
    },
  ];
}

/** True when every starter row is done. Pure. */
export function isDayOneComplete(items: readonly DayOneItem[]): boolean {
  return items.length > 0 && items.every((i) => i.done);
}

// ---------------------------------------------------------------------------
// Dismiss store (lazy storage, production only)
// ---------------------------------------------------------------------------

export async function isDayOneDismissed(): Promise<boolean> {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    return (await AsyncStorage.getItem(DAY_ONE_DISMISS_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Dismiss the strip forever. Best-effort — never fails the UI. */
export async function dismissDayOne(): Promise<void> {
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(DAY_ONE_DISMISS_KEY, '1').catch(() => {});
  } catch {
    // Dismissal is convenience, not the user flow — never throw.
  }
}
