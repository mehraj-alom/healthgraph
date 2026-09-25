/**
 * reminderNotifications.ts — thin wrapper over expo-notifications for the
 * medication reminder system.
 *
 * Loading rule (read first): the expo-notifications package runs push
 * side effects AT IMPORT TIME, which throws inside Expo Go. Nothing in
 * this file imports it statically — every use goes through loadModule()
 * AFTER isReminderRuntimeSupported() passes, so Expo Go never evaluates
 * the package at all. Type positions use `import type` (fully erased).
 *
 * Strongest compliant behavior without invasive permissions:
 * - Android: MAX-importance channel with alarm audio usage, vibration and
 *   the default sound (channel-owned on Android 8+), high-priority
 *   heads-up presentation, action buttons (Taken / Snooze).
 * - iOS: time-sensitive interruption so the reminder breaks through.
 * - No custom sound file (would need a bundled asset + rebuild config);
 *   the channel default plus vibration carries the alert.
 * - No full-screen intent: expo-notifications exposes no such API, and on
 *   Android 14+ USE_FULL_SCREEN_INTENT is restricted to clock/alarm roles
 *   under Play policy. The call-like surface is the in-app reminder
 *   screen opened from the tap or while the app is foreground.
 *
 * Every function is total: failures resolve to null/false/[] so the
 * scheduler can never crash its callers.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type * as Notifications from 'expo-notifications';
import {
  ACTION_SNOOZE_30,
  ACTION_SNOOZE_60,
  ACTION_TAKEN,
  REMINDER_CATEGORY_ID,
  REMINDER_CHANNEL_ID,
  type ReminderNotificationData,
  type ReminderTapAction,
  type ParsedReminderTap,
  parseReminderTap,
} from '@/services/reminderContract';

// Single import surface: contract identifiers stay reachable from here.
export {
  ACTION_SNOOZE_30,
  ACTION_SNOOZE_60,
  ACTION_TAKEN,
  REMINDER_CATEGORY_ID,
  REMINDER_CHANNEL_ID,
  type ReminderNotificationData,
  type ReminderTapAction,
  type ParsedReminderTap,
  parseReminderTap,
};

function devWarn(message: string): void {
  if (__DEV__) {
    console.warn(`[Reminders] ${message}`);
  }
}

/**
 * The reminder runtime needs a development build (or production): Expo
 * Go removed the native notification modules. All entry points check
 * this first and no-op, and the package itself is only loaded past it.
 */
export function isReminderRuntimeSupported(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    return Constants.appOwnership !== 'expo';
  } catch {
    return true;
  }
}

type NotificationsModule = typeof import('expo-notifications');

async function loadModule(): Promise<NotificationsModule | null> {
  if (!isReminderRuntimeSupported()) return null;
  try {
    return await import('expo-notifications');
  } catch (error) {
    devWarn(`module load failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return null;
  }
}

/** Idempotent: channel + action category are upserted on every call. */
export async function ensureReminderChannel(): Promise<void> {
  const N = await loadModule();
  if (!N) return;
  try {
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: 'Medication reminders',
        importance: N.AndroidImportance.MAX,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 500, 250, 500],
        enableLights: true,
        lightColor: '#FF0B7A55',
        showBadge: true,
        audioAttributes: {
          usage: N.AndroidAudioUsage.ALARM,
          contentType: N.AndroidAudioContentType.SONIFICATION,
          flags: {
            enforceAudibility: true,
            requestHardwareAudioVideoSynchronization: false,
          },
        },
      });
    }
    await N.setNotificationCategoryAsync(REMINDER_CATEGORY_ID, [
      { identifier: ACTION_TAKEN, buttonTitle: 'Taken' },
      { identifier: ACTION_SNOOZE_30, buttonTitle: 'Snooze 30 min' },
      { identifier: ACTION_SNOOZE_60, buttonTitle: 'Snooze 1 hour' },
    ]);
  } catch (error) {
    devWarn(`channel setup failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

/** Foreground presentation: banner + list + sound (call once at startup). */
export function setReminderNotificationHandler(): void {
  void (async () => {
    const N = await loadModule();
    if (!N) return;
    try {
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
          priority: N.AndroidNotificationPriority.MAX,
        }),
      });
    } catch (error) {
      devWarn(`handler setup failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  })();
}

/**
 * Moment-of-intent permission request: call only when the user saves a
 * medication with reminders on (never on mount, never on cold start).
 * Resolves true only when alerts can actually fire.
 */
export async function requestReminderPermissions(): Promise<boolean> {
  const N = await loadModule();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const next = await N.requestPermissionsAsync();
    return next.granted === true;
  } catch (error) {
    devWarn(`permission request failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return false;
  }
}

/** Current permission state without prompting. */
export async function getReminderPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const N = await loadModule();
  if (!N) return 'denied';
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return 'granted';
    return current.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'undetermined';
  }
}

export async function scheduleReminderNotification(input: {
  title: string;
  body: string;
  data: ReminderNotificationData;
  date: Date;
}): Promise<string | null> {
  const N = await loadModule();
  if (!N) return null;
  try {
    await ensureReminderChannel();
    const data: Record<string, unknown> = { ...input.data };
    return await N.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data,
        sound: 'default',
        priority: N.AndroidNotificationPriority.MAX,
        vibrate: [0, 500, 250, 500],
        categoryIdentifier: REMINDER_CATEGORY_ID,
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DATE,
        date: input.date,
        channelId: REMINDER_CHANNEL_ID,
      },
    });
  } catch (error) {
    devWarn(`schedule failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return null;
  }
}

export async function cancelReminderNotification(notificationId: string): Promise<void> {
  const N = await loadModule();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    devWarn(`cancel failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

/** Scheduled OS notifications belonging to one patient (data-tagged). */
export async function listPatientScheduledNotifications(
  patientId: string,
): Promise<{ identifier: string; occurrenceId: string | null }[]> {
  const N = await loadModule();
  if (!N) return [];
  try {
    const all = await N.getAllScheduledNotificationsAsync();
    const out: { identifier: string; occurrenceId: string | null }[] = [];
    for (const req of all) {
      const data = req.content.data as Partial<ReminderNotificationData> | undefined;
      if (data?.type === 'medication_reminder' && data.patient_id === patientId) {
        out.push({
          identifier: req.identifier,
          occurrenceId:
            typeof data.occurrence_id === 'string' ? data.occurrence_id : null,
        });
      }
    }
    return out;
  } catch (error) {
    devWarn(`list failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return [];
  }
}

/** Cancel every scheduled OS notification tagged to one patient. */
export async function cancelPatientReminders(patientId: string): Promise<void> {
  const rows = await listPatientScheduledNotifications(patientId);
  await Promise.all(rows.map((r) => cancelReminderNotification(r.identifier)));
}

export const notificationListeners = {
  addReceivedListener: (
    listener: (event: Notifications.Notification) => void,
  ): { remove: () => void } => {
    if (!isReminderRuntimeSupported()) return { remove: () => {} };
    // Fire-and-forget import: the module only loads on supported runtimes.
    // If it somehow fails, the listener simply never attaches.
    let sub: { remove: () => void } | null = null;
    void import('expo-notifications').then(
      (N) => {
        try {
          sub = N.addNotificationReceivedListener(listener);
        } catch (error) {
          devWarn(`listener attach failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      },
      () => {},
    );
    return {
      remove: () => {
        try {
          sub?.remove();
        } catch {
          // Already gone — nothing to detach.
        }
      },
    };
  },
  addResponseListener: (
    listener: (response: Notifications.NotificationResponse) => void,
  ): { remove: () => void } => {
    if (!isReminderRuntimeSupported()) return { remove: () => {} };
    let sub: { remove: () => void } | null = null;
    void import('expo-notifications').then(
      (N) => {
        try {
          sub = N.addNotificationResponseReceivedListener(listener);
        } catch (error) {
          devWarn(`listener attach failed: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      },
      () => {},
    );
    return {
      remove: () => {
        try {
          sub?.remove();
        } catch {
          // Already gone — nothing to detach.
        }
      },
    };
  },
};
