/**
 * medicationReminderSchedule.ts — pure reminder math (zero dependencies).
 *
 * Occurrence computation, reconcile diffing and snooze mapping take
 * explicit inputs and touch nothing native, so they are unit-tested
 * without a device. The slot rules mirror computeLocalSchedule
 * (local wall-clock HH:MM, weekday filter, start/end dates, PRN
 * skipped, frequency fallback times); the frequency map below copies
 * those same values and names its source.
 */

import type { MedicationTakenEvent } from '@/types';

/** How far ahead occurrences are materialized as OS notifications. */
export const REMINDER_HORIZON_DAYS = 7;
/** Upper bound on OS notifications per reconcile (OS-friendly). */
export const MAX_SCHEDULED_PER_RECONCILE = 60;
/** Snooze chains end here; the recurring schedule never changes. */
export const MAX_SNOOZE_COUNT = 5;
/** "Remind me later" with no later dose today falls back to +6h. */
export const LATER_FALLBACK_MINUTES = 360;

export interface ReminderOccurrence {
  occurrenceId: string;
  medicationId: string;
  medicationName: string;
  doseAmount: number | null;
  doseUnit: string | null;
  /** Local calendar day YYYY-MM-DD. */
  day: string;
  /** Local wall-clock HH:MM. */
  scheduledTime: string;
  /** Exact fire instant (local wall clock rendered as ISO). */
  scheduledAt: string;
}

export interface SnoozeOption {
  key: 'snooze-30' | 'snooze-60' | 'busy' | 'later-today' | 'next-time';
  label: string;
  minutes: number | null;
}

/** Frequency fallback times — same values as getDefaultScheduledTimes
 * in db/queries/medicationTakenEvents.ts (the schedule UI's source). */
export function defaultTimesForFrequency(frequency: string): string[] {
  switch (frequency) {
    case 'ONCE_DAILY': return ['08:00'];
    case 'TWICE_DAILY': return ['08:00', '20:00'];
    case 'THREE_TIMES_DAILY': return ['08:00', '14:00', '20:00'];
    case 'FOUR_TIMES_DAILY': return ['08:00', '12:00', '16:00', '20:00'];
    case 'EVERY_MORNING': return ['08:00'];
    case 'EVERY_EVENING': return ['20:00'];
    case 'EVERY_NIGHT': return ['22:00'];
    case 'EVERY_8_HOURS': return ['08:00', '16:00', '00:00'];
    case 'EVERY_12_HOURS': return ['08:00', '20:00'];
    case 'AS_NEEDED': return [];
    default: return ['08:00'];
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function localDayString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

/** Deterministic occurrence id: same dose slot always maps to one row. */
export function occurrenceIdFor(medicationId: string, day: string, time: string): string {
  return `${medicationId}|${day}|${time}`;
}

export function rootOccurrenceId(occurrenceId: string): string {
  const marker = '::snooze';
  const at = occurrenceId.indexOf(marker);
  return at < 0 ? occurrenceId : occurrenceId.slice(0, at);
}

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function parseTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (parseTime(entry)) out.push(entry.trim());
  }
  return Array.from(new Set(out));
}

function parseWeekdays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
  );
}

export interface SchedulableMedication {
  medication_id: string;
  name: string;
  dose_amount: number | null;
  dose_unit: string | null;
  frequency: string;
  scheduled_times: string[] | null;
  scheduled_weekdays: number[] | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  prn: boolean;
  reminder_enabled: boolean;
}

/**
 * Slots for one medication on one local day. Same guards as
 * computeLocalSchedule but pure and DB-free.
 */
export function slotsForMedication(
  med: SchedulableMedication,
  day: string,
): string[] {
  if (med.status !== 'ACTIVE') return [];
  if (med.prn) return [];
  if (!med.reminder_enabled) return [];
  if (med.start_date && med.start_date > day) return [];
  if (med.end_date && med.end_date < day) return [];
  const weekdays = parseWeekdays(med.scheduled_weekdays);
  if (weekdays && !weekdays.includes(localWeekday(day))) return [];
  let times = parseTimes(med.scheduled_times);
  if (times.length === 0) {
    times = defaultTimesForFrequency(med.frequency).filter((t) => parseTime(t));
  }
  return times;
}

/**
 * Future occurrences across the horizon, ascending. Wall-clock based:
 * DST and timezone shifts are absorbed on the next reconcile, which
 * always recomputes from the current local clock.
 */
export function computeReminderOccurrences(
  meds: readonly SchedulableMedication[],
  now: Date,
  days: number = REMINDER_HORIZON_DAYS,
): ReminderOccurrence[] {
  const out: ReminderOccurrence[] = [];
  for (let offset = 0; offset < days; offset++) {
    const cursor = new Date(now);
    cursor.setDate(cursor.getDate() + offset);
    const day = localDayString(cursor);
    for (const med of meds) {
      for (const time of slotsForMedication(med, day)) {
        const parsed = parseTime(time);
        if (!parsed) continue;
        const fireAt = new Date(cursor);
        fireAt.setHours(parsed.hours, parsed.minutes, 0, 0);
        if (fireAt.getTime() <= now.getTime()) continue;
        out.push({
          occurrenceId: occurrenceIdFor(med.medication_id, day, time),
          medicationId: med.medication_id,
          medicationName: med.name,
          doseAmount: med.dose_amount,
          doseUnit: med.dose_unit,
          day,
          scheduledTime: time,
          scheduledAt: fireAt.toISOString(),
        });
      }
    }
  }
  out.sort((a, b) =>
    a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0,
  );
  return out.slice(0, MAX_SCHEDULED_PER_RECONCILE);
}

/** Local (day, HH:MM) key of a taken event's scheduled_for, if parseable. */
export function takenSlotKey(
  event: Pick<MedicationTakenEvent, 'scheduled_for'>,
): string | null {
  if (!event.scheduled_for) return null;
  const d = new Date(event.scheduled_for);
  if (Number.isNaN(d.getTime())) return null;
  return `${localDayString(d)}|${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export interface TrackedInstance {
  occurrence_id: string;
  medication_id: string;
  status: string;
  notification_id: string | null;
}

export interface ReconcileDiff {
  toSchedule: ReminderOccurrence[];
  toCancel: TrackedInstance[];
  skippedTaken: number;
}

/**
 * Pure diff: desired future occurrences vs tracked instances.
 * - Already-taken slots (matched taken events) are never scheduled.
 * - Live 'scheduled' rows with no matching desired occurrence are stale.
 * - A 'scheduled' row WITHOUT an OS notification id counts as missing
 *   (schedule failed or ran where the runtime is unsupported) and is
 *   retried instead of trusted.
 * - A 'scheduled' row whose id is absent from the OS list (pass
 *   osScheduledIds) is likewise retried: the OS is authoritative for
 *   what will actually fire (logout cancels, user dismissals, reboot
 *   loss), the DB row is only a claim.
 * - Snoozed rows and rows already taken/dismissed are left alone.
 */
export function diffReconcile(
  desired: readonly ReminderOccurrence[],
  existing: readonly TrackedInstance[],
  takenEvents: readonly Pick<MedicationTakenEvent, 'medication_id' | 'scheduled_for'>[],
  osScheduledIds: ReadonlySet<string> | null = null,
): ReconcileDiff {
  const takenKeys = new Set<string>();
  for (const ev of takenEvents) {
    const key = takenSlotKey(ev);
    if (key) takenKeys.add(`${ev.medication_id}|${key}`);
  }
  const live = desired.filter(
    (o) => !takenKeys.has(`${o.medicationId}|${o.day}|${o.scheduledTime}`),
  );
  const liveIds = new Set(live.map((o) => o.occurrenceId));
  const haveIds = new Set(
    existing
      .filter(
        (i) =>
          (i.status === 'scheduled' &&
            i.notification_id != null &&
            (osScheduledIds == null || osScheduledIds.has(i.notification_id))) ||
          i.status === 'snoozed',
      )
      .map((i) => i.occurrence_id),
  );
  return {
    toSchedule: live.filter((o) => !haveIds.has(o.occurrenceId)),
    toCancel: existing.filter(
      (i) => i.status === 'scheduled' && !liveIds.has(i.occurrence_id),
    ),
    skippedTaken: desired.length - live.length,
  };
}

/**
 * Deterministic delay sheet. Both "Still not taken" and "Remind me
 * later" open these same choices; neither button schedules anything
 * by itself. "Later" never touches the recurring schedule.
 * - 30 minutes / 1 hour / busy (+2h): fixed offsets from now.
 * - Later today: +4h.
 * - Next suitable time: the next scheduled dose, else +6h.
 */
export function snoozeOptionsFor(
  occurrence: Pick<ReminderOccurrence, 'scheduledAt' | 'medicationId'>,
  futureOccurrences: readonly Pick<ReminderOccurrence, 'medicationId' | 'scheduledAt'>[],
  nowMs: number = Date.now(),
): SnoozeOption[] {
  const next = futureOccurrences
    .filter(
      (o) =>
        o.medicationId === occurrence.medicationId &&
        new Date(o.scheduledAt).getTime() > nowMs,
    )
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))[0];
  const nextMinutes = next
    ? Math.max(
        15,
        Math.round((new Date(next.scheduledAt).getTime() - nowMs) / 60000),
      )
    : LATER_FALLBACK_MINUTES;
  return [
    { key: 'snooze-30', label: 'Remind me in 30 minutes', minutes: 30 },
    { key: 'snooze-60', label: 'Remind me in 1 hour', minutes: 60 },
    { key: 'busy', label: "I'm busy — remind me in 2 hours", minutes: 120 },
    { key: 'later-today', label: 'Remind me later today', minutes: 240 },
    { key: 'next-time', label: 'Remind me at the next suitable time', minutes: nextMinutes },
  ];
}

export interface NextSnooze {
  occurrenceId: string;
  scheduledAt: string;
  scheduledTime: string;
  snoozeCount: number;
}

/**
 * Pure next link in a snooze chain (no IO): id, fire time and count.
 * Throws on out-of-range minutes or an exhausted chain.
 */
export function nextSnoozeOccurrence(
  rootOccurrenceId: string,
  chainCount: number,
  minutes: number,
  nowMs: number = Date.now(),
): NextSnooze {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error('Snooze length is out of range.');
  }
  if (chainCount >= MAX_SNOOZE_COUNT) {
    throw new Error('Snooze limit reached for this dose.');
  }
  const fireAt = new Date(nowMs + minutes * 60000);
  return {
    occurrenceId: `${rootOccurrenceId}::snooze${chainCount + 1}`,
    scheduledAt: fireAt.toISOString(),
    scheduledTime: `${pad2(fireAt.getHours())}:${pad2(fireAt.getMinutes())}`,
    snoozeCount: chainCount + 1,
  };
}
