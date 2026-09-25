/**
 * medicationReminders.ts — local-first medication reminder orchestration.
 *
 * Pure math (occurrences, diff, snooze mapping) lives in
 * medicationReminderSchedule.ts and is unit-tested without a device.
 * This module holds the IO: loading medications (server when online,
 * local mirror offline), applying the diff to the OS scheduler,
 * snoozing, taking through the existing event system, and cancelling.
 *
 * No polling, no background process. Reconcile never throws.
 */

import { api } from '@/services/api';
import { isOnline } from '@/services/networkMonitor';
import {
  getMedications as dbGetMedications,
  getMedicationById as dbGetMedicationById,
} from '@/db/queries/medications';
import { getTakenEventsInRange } from '@/db/queries/medicationTakenEvents';
import {
  getReminderInstance,
  listReminderInstancesFrom,
  pruneReminderInstances,
  setReminderInstanceStatus,
  upsertReminderInstance,
  type ReminderInstance,
} from '@/db/queries/reminderInstances';
import {
  cancelPatientReminders,
  cancelReminderNotification,
  listPatientScheduledNotifications,
  scheduleReminderNotification,
} from '@/services/reminderNotifications';
import { requestDataRefresh } from '@/services/dataRefresh';
import type { DoseTakenStatus, Medication, MedicationTakenEvent } from '@/types';
import {
  REMINDER_HORIZON_DAYS,
  MAX_SNOOZE_COUNT,
  computeReminderOccurrences,
  diffReconcile,
  localDayString,
  nextSnoozeOccurrence,
  rootOccurrenceId,
  snoozeOptionsFor,
  type ReminderOccurrence,
  type SchedulableMedication,
  type SnoozeOption,
} from '@/services/medicationReminderSchedule';

// Single import surface for screens: pure API re-exported from here.
export {
  REMINDER_HORIZON_DAYS,
  MAX_SNOOZE_COUNT,
  computeReminderOccurrences,
  diffReconcile,
  localDayString,
  nextSnoozeOccurrence,
  rootOccurrenceId,
  snoozeOptionsFor,
  type ReminderOccurrence,
  type SchedulableMedication,
  type SnoozeOption,
} from '@/services/medicationReminderSchedule';

function toSchedulable(med: Medication): SchedulableMedication {
  return {
    medication_id: med.medication_id,
    name: med.name,
    dose_amount: med.dose_amount,
    dose_unit: med.dose_unit,
    frequency: med.frequency,
    scheduled_times: med.scheduled_times,
    scheduled_weekdays: med.scheduled_weekdays,
    start_date: med.start_date,
    end_date: med.end_date,
    status: med.status,
    prn: med.prn,
    reminder_enabled: med.reminder_enabled,
  };
}

function doseSuffix(occ: Pick<ReminderOccurrence, 'doseAmount' | 'doseUnit'>): string {
  return occ.doseAmount != null
    ? ` · ${occ.doseAmount}${occ.doseUnit ? ` ${occ.doseUnit}` : ''}`
    : '';
}

/** One live snooze per chain: an older sibling is cancelled first. */
export async function snoozeReminder(
  patientId: string,
  occurrenceId: string,
  minutes: number,
): Promise<ReminderInstance> {
  const current = await getReminderInstance(patientId, occurrenceId);
  if (!current) {
    throw new Error('This reminder is no longer active.');
  }
  if (current.status === 'taken') {
    throw new Error('This dose was already recorded.');
  }
  const rootId = rootOccurrenceId(current.occurrence_id);
  const root =
    rootId === current.occurrence_id
      ? current
      : await getReminderInstance(patientId, rootId);
  const chainCount = root ? root.snooze_count : current.snooze_count;
  const next = nextSnoozeOccurrence(rootId, chainCount, minutes);
  // Cancel any other live snooze in the same chain (single live reminder).
  const existing = await listReminderInstancesFrom(patientId, new Date(0).toISOString());
  for (const row of existing) {
    if (
      row.parent_occurrence_id === rootId &&
      row.status === 'scheduled' &&
      row.occurrence_id !== current.occurrence_id
    ) {
      if (row.notification_id) {
        await cancelReminderNotification(row.notification_id);
      }
      await setReminderInstanceStatus(patientId, row.occurrence_id, 'dismissed');
    }
  }
  const fireAt = new Date(next.scheduledAt);
  const med = await dbGetMedicationById(patientId, current.medication_id).catch(() => null);
  const medName = med?.name ?? 'Medication';
  const notificationId = await scheduleReminderNotification({
    title: 'Medication reminder',
    body: `Time for ${medName} (snoozed)`,
    data: {
      type: 'medication_reminder',
      patient_id: patientId,
      medication_id: current.medication_id,
      occurrence_id: next.occurrenceId,
      scheduled_at: next.scheduledAt,
    },
    date: fireAt,
  });
  const row: Omit<ReminderInstance, 'created_at'> = {
    occurrence_id: next.occurrenceId,
    patient_id: patientId,
    medication_id: current.medication_id,
    scheduled_at: next.scheduledAt,
    scheduled_time: next.scheduledTime,
    status: 'scheduled',
    snooze_count: next.snoozeCount,
    parent_occurrence_id: rootId,
    notification_id: notificationId,
  };
  await upsertReminderInstance(row);
  await setReminderInstanceStatus(patientId, current.occurrence_id, 'snoozed');
  if (root) {
    await upsertReminderInstance({ ...root, snooze_count: next.snoozeCount });
  }
  return { ...row, created_at: new Date().toISOString() };
}

// ─── Taken (existing event system) ──────────────────────────────────────────

// In-flight Taken guard: two rapid taps must not record two events. The
// screen also disables its buttons, but only the service sees every
// caller (screen, shade shortcut, timeline), so atomicity lives here.
const takeInFlight = new Set<string>();

export async function takeReminderDose(
  patientId: string,
  occurrenceId: string,
): Promise<{ localEventId: string; serverEventId: string | null }> {
  const flightKey = `${patientId}|${occurrenceId}`;
  if (takeInFlight.has(flightKey)) {
    throw new Error('This dose is already being recorded.');
  }
  takeInFlight.add(flightKey);
  try {
    const instance = await getReminderInstance(patientId, occurrenceId);
    if (!instance) {
      throw new Error('This reminder is no longer active.');
    }
    if (instance.status === 'taken') {
      throw new Error('This dose was already recorded.');
    }
    const { recordMedicationTaken } = await import('@/hooks/useMedications');
    const med = await dbGetMedicationById(patientId, instance.medication_id).catch(() => null);
    const result = await recordMedicationTaken(
      patientId,
      instance.medication_id,
      med?.dose_amount ?? null,
      med?.dose_unit ?? null,
      instance.scheduled_time,
    );
    if (instance.notification_id) {
      await cancelReminderNotification(instance.notification_id);
    }
    await setReminderInstanceStatus(patientId, occurrenceId, 'taken');
    const { requestDataRefresh: refresh } = await import('@/services/dataRefresh');
    refresh();
    return result;
  } finally {
    takeInFlight.delete(flightKey);
  }
}

// ─── Canonical reconciliation ───────────────────────────────────────────────

export interface ReconcileResult {
  scheduled: number;
  cancelled: number;
  skippedTaken: number;
}

function devWarn(message: string): void {
  if (__DEV__) {
    console.warn(`[Reminders] ${message}`);
  }
}

async function loadReminderMeds(patientId: string): Promise<Medication[]> {
  try {
    if (isOnline()) {
      const response = await api.get<{ medications: Medication[]; total: number }>(
        '/api/v1/medications',
      );
      if (Array.isArray(response.medications)) return response.medications;
    }
  } catch (error) {
    devWarn(`server med list failed, using local mirror: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  try {
    return await dbGetMedications(patientId);
  } catch (error) {
    devWarn(`local med list failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return [];
  }
}

/**
 * Canonical entry point. Safe to call repeatedly and concurrently: a
 * module-level flight guard collapses overlapping runs into one,
 * deterministic occurrence ids make scheduling idempotent, stale rows
 * are cancelled, taken slots are skipped, old rows are pruned, and the
 * OS list is authoritative for what will actually fire. Never throws.
 */
let reconcileFlight: Promise<ReconcileResult> | null = null;

export function reconcileMedicationReminders(
  patientId: string,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  if (!reconcileFlight) {
    reconcileFlight = runReconcile(patientId, now).finally(() => {
      reconcileFlight = null;
    });
  }
  return reconcileFlight;
}

async function runReconcile(patientId: string, now: Date): Promise<ReconcileResult> {
  const empty: ReconcileResult = { scheduled: 0, cancelled: 0, skippedTaken: 0 };
  try {
    const meds = (await loadReminderMeds(patientId)).filter(
      (m) => m.patient_id === patientId,
    );
    const schedulable = meds.map(toSchedulable);
    const desired = computeReminderOccurrences(schedulable, now, REMINDER_HORIZON_DAYS);
    const horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + REMINDER_HORIZON_DAYS);
    const taken = await getTakenEventsInRange(
      patientId,
      now.toISOString(),
      horizonEnd.toISOString(),
    ).catch(() => [] as MedicationTakenEvent[]);
    // Taken events from the trailing day also suppress their slots (a dose
    // taken late still counts for its occurrence).
    const trailingStart = new Date(now);
    trailingStart.setDate(trailingStart.getDate() - 1);
    const trailing = await getTakenEventsInRange(
      patientId,
      trailingStart.toISOString(),
      now.toISOString(),
    ).catch(() => [] as MedicationTakenEvent[]);
    const yesterday = localDayString(new Date(now.getTime() - 24 * 3600 * 1000));
    const existing = await listReminderInstancesFrom(patientId, yesterday).catch(
      () => [] as ReminderInstance[],
    );
    // The OS list is authoritative: rows the OS no longer holds (logout
    // cancel, user dismissal, reboot loss, failed schedule) are retried
    // instead of trusted.
    const osRows = await listPatientScheduledNotifications(patientId).catch(
      () => [] as { identifier: string; occurrenceId: string | null }[],
    );
    const osIds = new Set(
      osRows.map((r) => r.identifier).filter((id) => id.length > 0),
    );
    const { toSchedule, toCancel, skippedTaken } = diffReconcile(
      desired,
      existing,
      [...taken, ...trailing],
      osIds,
    );
    empty.skippedTaken = skippedTaken;
    for (const stale of toCancel) {
      if (stale.notification_id) {
        await cancelReminderNotification(stale.notification_id);
      }
      await setReminderInstanceStatus(patientId, stale.occurrence_id, 'dismissed').catch(
        () => false,
      );
      empty.cancelled += 1;
    }
    for (const occ of toSchedule) {
      const notificationId = await scheduleReminderNotification({
        title: 'Medication reminder',
        body: `Time for ${occ.medicationName}${doseSuffix(occ)}`,
        data: {
          type: 'medication_reminder',
          patient_id: patientId,
          medication_id: occ.medicationId,
          occurrence_id: occ.occurrenceId,
          scheduled_at: occ.scheduledAt,
        },
        date: new Date(occ.scheduledAt),
      });
      await upsertReminderInstance({
        occurrence_id: occ.occurrenceId,
        patient_id: patientId,
        medication_id: occ.medicationId,
        scheduled_at: occ.scheduledAt,
        scheduled_time: occ.scheduledTime,
        status: 'scheduled',
        snooze_count: 0,
        parent_occurrence_id: null,
        notification_id: notificationId,
      }).catch(() => {});
      if (notificationId) empty.scheduled += 1;
    }
    const pruneBefore = new Date(now);
    pruneBefore.setDate(pruneBefore.getDate() - 1);
    await pruneReminderInstances(patientId, pruneBefore.toISOString()).catch(() => 0);
    return empty;
  } catch (error) {
    devWarn(`reconcile failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return empty;
  }
}

/** Cancel every OS reminder tagged to one patient (logout path). */
export async function cancelAllPatientReminders(patientId: string): Promise<void> {
  try {
    await cancelPatientReminders(patientId);
  } catch (error) {
    devWarn(`cancel-all failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}

/** Dose statuses this system ever writes (the existing vocabulary). */
export const REMINDER_TAKEN_STATUS: DoseTakenStatus = 'TAKEN';
