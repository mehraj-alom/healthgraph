/**
 * Voice check-in schedule — one daily call at the user's chosen time.
 *
 * The time persists in AsyncStorage; enabling it requests notification
 * permission (moment-of-intent) and books a daily OS alarm carrying
 * `{ kind: 'voice-checkin' }`, which the App reminder bridge routes to
 * the incoming-call screen. Disabling cancels the alarm. No timers,
 * no polling — the OS wakes us.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  ensureReminderChannel,
  isReminderRuntimeSupported,
  requestReminderPermissions,
} from '@/services/reminderNotifications';

export interface VoiceCheckinTime {
  hour: number;
  minute: number;
  enabled: boolean;
}

const STORE_KEY = 'voice-checkin-time-v1';
const NOTIF_ID_KEY = 'voice-checkin-notif-id-v1';

export const VOICE_CHECKIN_KIND = 'voice-checkin';

export const DEFAULT_TIME: VoiceCheckinTime = { hour: 20, minute: 0, enabled: false };

export async function getVoiceCheckin(): Promise<VoiceCheckinTime> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_TIME;
    const parsed = JSON.parse(raw) as Partial<VoiceCheckinTime>;
    const hour = typeof parsed.hour === 'number' ? Math.max(0, Math.min(23, Math.round(parsed.hour))) : 20;
    const minute = typeof parsed.minute === 'number' ? Math.max(0, Math.min(59, Math.round(parsed.minute))) : 0;
    return { hour, minute, enabled: parsed.enabled === true };
  } catch {
    return DEFAULT_TIME;
  }
}

async function cancelScheduled(): Promise<void> {
  try {
    const id = await AsyncStorage.getItem(NOTIF_ID_KEY);
    if (!id) return;
    const N = await import('expo-notifications');
    await N.cancelScheduledNotificationAsync(id).catch(() => {});
    await AsyncStorage.removeItem(NOTIF_ID_KEY).catch(() => {});
  } catch {
    // Best-effort; a stale alarm is harmless (bridge stale-guards).
  }
}

/**
 * Persist the time and (re)book the daily alarm. Returns false when
 * notifications cannot fire (permission denied or unsupported runtime) —
 * the time is still saved, the alarm simply isn't booked.
 */
export async function setVoiceCheckin(next: VoiceCheckinTime): Promise<boolean> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
  await cancelScheduled();
  if (!next.enabled) return true;
  if (!isReminderRuntimeSupported()) return false;
  const granted = await requestReminderPermissions();
  if (!granted) return false;
  try {
    const N = await import('expo-notifications');
    await ensureReminderChannel();
    const patientId = getCachedPatientId();
    const id = await N.scheduleNotificationAsync({
      content: {
        title: 'Health check-in',
        body: 'Your voice check-in call is here. Tap to answer.',
        data: { kind: VOICE_CHECKIN_KIND, patientId: patientId ?? null },
        sound: 'default',
        priority: N.AndroidNotificationPriority.MAX,
        vibrate: [0, 500, 250, 500],
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        hour: next.hour,
        minute: next.minute,
      },
    });
    await AsyncStorage.setItem(NOTIF_ID_KEY, id).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** True when a notification payload is a voice check-in call. */
export function isVoiceCheckinTap(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).kind === VOICE_CHECKIN_KIND
  );
}
