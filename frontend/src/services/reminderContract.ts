/**
 * reminderContract.ts — notification identity contract (zero dependencies).
 *
 * Action identifiers, channel ids, the minimal notification payload and
 * the tap parser live here so they are unit-testable without native
 * modules. The expo wrapper (reminderNotifications.ts) implements them.
 */

export const REMINDER_CHANNEL_ID = 'medication-reminders';
export const REMINDER_CATEGORY_ID = 'med-reminder';

export const ACTION_TAKEN = 'MED_REMINDER_TAKEN';
export const ACTION_SNOOZE_30 = 'MED_REMINDER_SNOOZE_30';
export const ACTION_SNOOZE_60 = 'MED_REMINDER_SNOOZE_60';

export interface ReminderNotificationData {
  type: 'medication_reminder';
  patient_id: string;
  medication_id: string;
  occurrence_id: string;
  scheduled_at: string;
}

export type ReminderTapAction = 'open' | 'taken' | 'snooze-30' | 'snooze-60';

export interface ParsedReminderTap {
  patientId: string;
  occurrenceId: string;
  action: ReminderTapAction;
}

/**
 * Validate a notification interaction against the current patient and
 * extract the reminder routing. Returns null for anything foreign,
 * malformed, or belonging to another patient (never act on those).
 */
export function parseReminderTap(
  data: unknown,
  actionIdentifier: string,
  currentPatientId: string | null,
  defaultActionIdentifier: string,
): ParsedReminderTap | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'medication_reminder') return null;
  if (typeof d.patient_id !== 'string' || typeof d.occurrence_id !== 'string') {
    return null;
  }
  if (!currentPatientId || d.patient_id !== currentPatientId) return null;
  let action: ReminderTapAction = 'open';
  if (actionIdentifier === ACTION_TAKEN) action = 'taken';
  else if (actionIdentifier === ACTION_SNOOZE_30) action = 'snooze-30';
  else if (actionIdentifier === ACTION_SNOOZE_60) action = 'snooze-60';
  else if (actionIdentifier !== defaultActionIdentifier) return null;
  return { patientId: d.patient_id, occurrenceId: d.occurrence_id, action };
}
