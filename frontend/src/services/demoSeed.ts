/**
 * demoSeed.ts — synthetic reviewer data for the sandbox demo (RN wiring,
 * injectable logic).
 *
 * Minimal trio, honestly labeled: 7 daily check-ins (3 with distanced
 * activities), 2 medications (reminders OFF — a demo must never arm OS
 * alarms) + 4 taken events, 5 completed meditation sits. Every note says
 * it is sample data. Nothing here touches the network; rows land in local
 * SQLite under the demo patient id only.
 *
 * The core builder takes its storage functions as arguments so node tests
 * drive it with recording fakes; default wiring below binds the real
 * query modules (lazy, like every other production entry point).
 */

import type { DailyCheckInRequest } from '@/types';
import type { NewMeditationSession } from '@/db/queries/meditation';
import { DEMO_PATIENT_ID } from './demoMode.ts';

export interface DemoSeedDeps {
  upsertLog: (patientId: string, request: DailyCheckInRequest) => Promise<string>;
  addMedication: (
    patientId: string,
    med: {
      name: string;
      status: 'ACTIVE';
      frequency: 'ONCE_DAILY' | 'EVERY_MORNING' | 'EVERY_EVENING';
      dose_amount: number | null;
      dose_unit: string | null;
      notes: string | null;
    },
  ) => Promise<string>;
  addTaken: (
    patientId: string,
    event: { medication_id: string; taken_at: string; status: 'TAKEN'; notes: string | null },
  ) => Promise<string>;
  addSit: (patientId: string, sit: NewMeditationSession) => Promise<string>;
}

export interface DemoSeedReport {
  logs: number;
  medications: number;
  taken: number;
  sits: number;
}

const SAMPLE_NOTE = 'Sample data — demo mode, nothing leaves this phone.';

function dayKey(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoAt(day: string, hhmm: string): string {
  return `${day}T${hhmm}:00`;
}

/** Deterministic seed plan: same shape every run, dates trail today. */
export async function seedDemoData(
  deps: DemoSeedDeps,
  patientId: string,
): Promise<DemoSeedReport> {
  // Seven daily check-ins with gentle variation (never alarming values).
  const wellbeing = [4, 3, 4, 3, 4, 3, 4];
  const sleepMin = [440, 400, 460, 420, 450, 390, 430];
  for (let back = 6; back >= 0; back--) {
    const date = dayKey(back);
    const idx = 6 - back;
    const activities: DailyCheckInRequest['activities'] = [];
    if (back === 0) {
      activities.push({ activity_type: 'running', duration_minutes: 30, calories_burned: 320, distance_km: 5.2 });
    } else if (back === 2) {
      activities.push({ activity_type: 'walking', duration_minutes: 45, distance_km: 3.1 });
    } else if (back === 4) {
      activities.push({ activity_type: 'cycling', duration_minutes: 40, calories_burned: 280, distance_km: 12.4 });
    }
    await deps.upsertLog(patientId, {
      log_date: date,
      overall_wellbeing: wellbeing[idx] ?? 3,
      energy_level: 3,
      stress_level: 2,
      sleep: { duration_minutes: sleepMin[idx] ?? 420 },
      nutrition: { water_ml: 1750, meals_count: 3 },
      notes: back === 0 ? SAMPLE_NOTE : undefined,
      symptoms: [],
      vitals: [],
      pain: [],
      activities,
      medications: [],
    });
  }

  // Two daily medications. Reminders stay OFF in demo by policy.
  const vitD = await deps.addMedication(patientId, {
    name: 'Vitamin D3',
    status: 'ACTIVE',
    frequency: 'EVERY_MORNING',
    dose_amount: 1000,
    dose_unit: 'IU',
    notes: SAMPLE_NOTE,
  });
  const mg = await deps.addMedication(patientId, {
    name: 'Magnesium',
    status: 'ACTIVE',
    frequency: 'EVERY_EVENING',
    dose_amount: 250,
    dose_unit: 'mg',
    notes: SAMPLE_NOTE,
  });
  let taken = 0;
  for (const back of [0, 1, 2]) {
    await deps.addTaken(patientId, {
      medication_id: vitD,
      taken_at: isoAt(dayKey(back), '08:05'),
      status: 'TAKEN',
      notes: SAMPLE_NOTE,
    });
    taken += 1;
  }
  await deps.addTaken(patientId, {
    medication_id: mg,
    taken_at: isoAt(dayKey(0), '21:30'),
    status: 'TAKEN',
    notes: SAMPLE_NOTE,
  });
  taken += 1;

  // Five completed morning sits.
  let sits = 0;
  for (const back of [0, 1, 2, 3, 4]) {
    const started = isoAt(dayKey(back), '08:00');
    await deps.addSit(patientId, {
      preset_min: 10,
      duration_sec: 600,
      started_at: `${started}.000Z`,
      ended_at: `${dayKey(back)}T08:10:00.000Z`,
      completed: true,
      notes: back === 0 ? SAMPLE_NOTE : null,
    });
    sits += 1;
  }

  return { logs: 7, medications: 2, taken, sits };
}

/** Default wiring against the real query modules (demo patient only). */
export async function seedDemoPatient(
  patientId: string = DEMO_PATIENT_ID,
): Promise<DemoSeedReport> {
  const { upsertDailyLog } = await import('@/db/queries/dailyLogs');
  const { insertMedication } = await import('@/db/queries/medications');
  const { insertMedicationTakenEvent } = await import('@/db/queries/medicationTakenEvents');
  const { insertMeditationSession } = await import('@/db/queries/meditation');
  return seedDemoData(
    {
      upsertLog: (pid, request) => upsertDailyLog(pid, request),
      addMedication: (pid, med) =>
        insertMedication(pid, {
          name: med.name,
          generic_name: null,
          brand_name: null,
          strength: null,
          strength_unit: null,
          dose_amount: med.dose_amount,
          dose_unit: med.dose_unit,
          route: 'ORAL',
          frequency: med.frequency,
          scheduled_times: null,
          scheduled_weekdays: null,
          start_date: null,
          end_date: null,
          status: med.status,
          purpose: null,
          instructions: null,
          prescriber: null,
          prn: false,
          reminder_enabled: false,
          notes: med.notes,
          source_document_id: null,
          supply_quantity: null,
          supply_started_on: null,
          refills_left: null,
        }),
      addTaken: (pid, event) =>
        insertMedicationTakenEvent(pid, {
          medication_id: event.medication_id,
          taken_at: event.taken_at,
          scheduled_for: null,
          dose_taken: null,
          dose_unit: null,
          status: event.status,
          notes: event.notes,
          clinical_event_id: null,
        }),
      addSit: (pid, sit) => insertMeditationSession(pid, sit),
    },
    patientId,
  );
}
