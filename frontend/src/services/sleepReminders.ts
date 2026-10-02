/**
 * sleepReminders.ts — bedtime reminder store + schedule wiring.
 *
 * State lives in one versioned AsyncStorage key; the OS schedule is a
 * single DAILY notification (no exact-alarm permission needed — it may
 * fire inexactly on aggressive Android skins, same caveat as the voice
 * check-in). expo-notifications is loaded dynamically past the runtime
 * gate (Expo Go safety, same as reminderNotifications.ts).
 *
 * Never imported by node tests (native + storage imports); covered by tsc
 * and the contract tests in sleepReminderPlan.test.mts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as Notifications from 'expo-notifications';
import {
  ensureReminderChannel,
  isReminderRuntimeSupported,
  requestReminderPermissions,
} from './reminderNotifications';
import {
  REMINDER_STORAGE_KEY,
  normalizeReminderState,
  validateReminderTime,
  type SleepReminderState,
} from './sleepReminderPlan';

const NOTIF_ID_KEY = 'hg:sleep-reminder-notif-id:v1';

type NotificationsModule = typeof Notifications;

async function loadModule(): Promise<NotificationsModule | null> {
  if (!isReminderRuntimeSupported()) return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

/** Current reminder state; corrupt or missing storage means off. */
export async function getSleepReminder(): Promise<SleepReminderState> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_STORAGE_KEY);
    if (raw === null) return normalizeReminderState(null);
    return normalizeReminderState(JSON.parse(raw));
  } catch {
    return normalizeReminderState(null);
  }
}

async function cancelScheduled(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(NOTIF_ID_KEY);
    await AsyncStorage.removeItem(NOTIF_ID_KEY).catch(() => {});
    if (!id) return;
    const N = await loadModule();
    await N?.cancelScheduledNotificationAsync(id).catch(() => {});
  } catch {
    // Best-effort: a stale OS schedule without our id is harmless.
  }
}

/**
 * Persist the reminder and (re)arm the daily OS notification. Returns false
 * when the schedule could not be armed (permissions, Expo Go) — state is
 * still saved so the screen reports honestly.
 */
export async function setSleepReminder(next: SleepReminderState): Promise<boolean> {
  const clean: SleepReminderState = validateReminderTime(next.hour, next.minute).ok
    ? { enabled: next.enabled === true, hour: next.hour, minute: next.minute }
    : { enabled: false, hour: next.hour, minute: next.minute };
  await AsyncStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(clean)).catch(() => {});
  await cancelScheduled();
  if (!clean.enabled) return true;
  const permitted = await requestReminderPermissions().catch(() => false);
  if (!permitted) return false;
  try {
    await ensureReminderChannel();
    const N = await loadModule();
    if (!N) return false;
    const hour = String(clean.hour).padStart(2, '0');
    const minute = String(clean.minute).padStart(2, '0');
    const id = await N.scheduleNotificationAsync({
      content: {
        title: 'Time to wind down',
        body: `Lights out at ${hour}:${minute} — your usual bedtime.`,
        data: { kind: 'sleep-reminder' },
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        hour: clean.hour,
        minute: clean.minute,
      },
    });
    await AsyncStorage.setItem(NOTIF_ID_KEY, id).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
