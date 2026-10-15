/**
 * deviceExportShare.ts — collect device rows, write the CSV, open the OS
 * share sheet (RN only, native imports).
 *
 * Collection is best-effort per table: one failing query yields an empty
 * domain, never a failed export. The temp file is wiped after the sheet
 * closes (the user chose where the copy lives from then on).
 *
 * Never imported by node tests (native imports); covered by tsc and the
 * contract tests in deviceExport.test.mts.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  buildExportRows,
  exportFileName,
  toCsv,
  type DeviceExportInput,
} from './deviceExport';
import { listMeditationSessions } from '@/db/queries/meditation';
import { listSubstanceEntries } from '@/db/queries/substances';
import { listCravingEntries } from '@/db/queries/cravings';
import { listCycleEntries } from '@/db/queries/cycle';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getRecentRppgMeasurements } from '@/db/queries/rppg';
import { getDailyLogs } from '@/db/queries/dailyLogs';
import { getMedications } from '@/db/queries/medications';
import { getMedicationTakenEvents } from '@/db/queries/medicationTakenEvents';
import { todayKey } from '@/screens/Onboarding/momentum';

/** Bounds keep a multi-year library shareable; newest rows win. */
const EXPORT_LIMIT = 1000;

async function quiet<T>(work: Promise<T[]>, fallback: T[] = []): Promise<T[]> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

/** Gather every exportable device table for one patient. */
export async function collectDeviceExportInput(
  patientId: string,
): Promise<DeviceExportInput> {
  const [
    meditation,
    substance,
    cravings,
    cycle,
    ppg,
    rppg,
    logs,
    medications,
    taken,
  ] = await Promise.all([
    quiet(listMeditationSessions(patientId, EXPORT_LIMIT)),
    quiet(listSubstanceEntries(patientId, EXPORT_LIMIT)),
    quiet(listCravingEntries(patientId, EXPORT_LIMIT)),
    quiet(listCycleEntries(patientId, EXPORT_LIMIT)),
    quiet(getRecentPpgMeasurements(patientId, EXPORT_LIMIT)),
    quiet(getRecentRppgMeasurements(patientId, EXPORT_LIMIT)),
    quiet(getDailyLogs(patientId, EXPORT_LIMIT)),
    quiet(getMedications(patientId)),
    quiet(getMedicationTakenEvents(patientId, EXPORT_LIMIT)),
  ]);
  const names = new Map(medications.map((m) => [m.medication_id, m.name]));
  return {
    meditation: meditation.map((s) => ({
      started_at: s.started_at,
      preset_min: s.preset_min,
      duration_sec: s.duration_sec,
      completed: s.completed,
      notes: s.notes,
    })),
    substance: substance.map((e) => ({
      occurred_at: e.occurred_at,
      category: e.category,
      amount_value: e.amount_value,
      amount_unit: e.amount_unit,
      notes: e.notes,
    })),
    cravings: cravings.map((c) => ({
      occurred_at: c.occurred_at,
      category: c.category,
      intensity: c.intensity,
      outcome: c.outcome,
      notes: c.notes,
    })),
    cycle: cycle.map((c) => ({ date: c.date, kind: c.kind, notes: c.notes })),
    ppg: ppg.map((m) => ({
      measured_at: m.measured_at,
      heart_rate_bpm: m.heart_rate_bpm,
      rmssd_ms: m.rmssd_ms,
    })),
    rppg: rppg.map((m) => ({
      measured_at: m.measured_at,
      heart_rate_bpm: m.heart_rate_bpm,
    })),
    // No list-all query exists for food-scan breakdowns; nutrition is
    // covered at log granularity through daily-log calories below.
    foodItems: [],
    dailyLogs: logs.map((l) => ({
      log_date: l.log_date,
      overall_wellbeing: l.overall_wellbeing,
      energy_level: l.energy_level,
      stress_level: l.stress_level,
      sleep_duration_minutes: l.sleep_duration_minutes,
      water_ml: l.water_ml,
      meals_count: l.meals_count,
      calories_kcal: l.calories_kcal,
      food_label: l.food_label,
      notes: l.notes,
    })),
    medications: medications.map((m) => ({
      name: m.name,
      status: m.status,
      frequency: m.frequency,
    })),
    taken: taken.map((t) => ({
      taken_at: t.taken_at,
      medication_name: names.get(t.medication_id) ?? null,
      status: t.status,
    })),
  };
}

export interface DeviceExportResult {
  /** Data rows written (header excluded). */
  rows: number;
  /** True when the OS sheet opened. */
  shared: boolean;
  /** File name offered to the sheet. */
  fileName: string;
}

/**
 * Build the CSV, write it to the cache dir, and open the share sheet.
 * Throws when no patient data exists or the file cannot be written.
 */
export async function exportAndShareDeviceCsv(
  patientId: string,
): Promise<DeviceExportResult> {
  const rows = buildExportRows(await collectDeviceExportInput(patientId));
  if (rows.length === 0) {
    throw new Error('Nothing to export yet. Log something first.');
  }
  const fileName = exportFileName(todayKey());
  const base = FileSystem.cacheDirectory;
  if (!base) {
    throw new Error('No writable cache directory on this device.');
  }
  const uri = `${base}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, toCsv(rows));
  let shared = false;
  try {
    const canShare = await Sharing.isAvailableAsync().catch(() => false);
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Share health data (CSV)',
      });
      shared = true;
    }
  } finally {
    // The user owns every copy from the sheet onward; ours is scrap.
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  return { rows: rows.length, shared, fileName };
}
