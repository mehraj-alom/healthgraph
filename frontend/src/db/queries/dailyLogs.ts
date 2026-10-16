/**
 * dailyLogs.ts — Local SQLite repository for Daily Log entities.
 *
 * Maps the DailyCheckInRequest/Response to local SQLite tables:
 * - daily_logs: group-level data (wellbeing, sleep, nutrition, notes)
 * - daily_log_events: individual clinical events (symptoms, vitals, pain, etc.)
 *
 * All queries are scoped to the authenticated patient via patient_id.
 */

import { getDatabase, withSerializedTransaction } from '@/db/connection';
import { todayKeyLocal } from '@/utils/dayKey';
import { parseClockTime } from '@/screens/SleepEngine/sleepEngine';
import { buildNotesAppend } from '@/services/voiceJournal';
import type {
  DailyCheckInRequest,
  DailyCheckInDetail,
} from '@/types';

/** Validated 'HH:MM' or null — garbage clock strings never reach storage. */
function validClockOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return parseClockTime(value) === null ? null : value;
}

// ─── Event Types (matches backend EventType enum) ────────────────────────────

export type DailyLogEventType =
  | 'WELLBEING_LOG'
  | 'SYMPTOM'
  | 'VITAL_SIGN'
  | 'PAIN_LOG'
  | 'SLEEP_LOG'
  | 'ACTIVITY_LOG'
  | 'NUTRITION_LOG'
  | 'MEDICATION_TAKEN'
  | 'PATIENT_NOTE';

// ─── Row Types ───────────────────────────────────────────────────────────────

interface DailyLogRow {
  group_id: string;
  patient_id: string;
  log_date: string;
  overall_wellbeing: number | null;
  energy_level: number | null;
  stress_level: number | null;
  sleep_duration_minutes: number | null;
  sleep_quality: number | null;
  sleep_awakenings: number | null;
  water_ml: number | null;
  meals_count: number | null;
  appetite_level: number | null;
  calories_kcal: number | null;
  food_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  local_id: string | null;
  sync_status: string;
  server_revision: number | null;
}

interface DailyLogEventRow {
  event_id: string;
  group_id: string;
  event_type: string;
  concept_id: string | null;
  event_time: string;
  payload_json: string;
  created_at: string;
  sync_status: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateLocalId(): string {
  return 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayLocalDateString(): string {
  return todayKeyLocal();
}

function parseJsonPayload(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Get a daily log by date, scoped to patient.
 * Returns the most recent log for the given date, or null if none exists.
 */
export async function getDailyLog(
  patientId: string,
  date: string,
): Promise<DailyLogRow | null> {
  const db = await getDatabase();
  const result = await db.getFirstAsync<DailyLogRow>(
    'SELECT * FROM daily_logs WHERE patient_id = ? AND log_date = ? ORDER BY updated_at DESC LIMIT 1',
    [patientId, date],
  );
  return result ?? null;
}

/**
 * Get multiple daily logs for a patient, ordered by date descending.
 */
export async function getDailyLogs(
  patientId: string,
  limit: number = 30,
): Promise<DailyLogRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<DailyLogRow>(
    'SELECT * FROM daily_logs WHERE patient_id = ? ORDER BY log_date DESC LIMIT ?',
    [patientId, limit],
  );
}

/** One logged night: group-level sleep columns for a single date. */
export interface SleepNightRow {
  log_date: string;
  sleep_duration_minutes: number;
  sleep_quality: number | null;
  sleep_awakenings: number | null;
}

/**
 * Bounded sleep history for the Sleep Engine: nights with a real logged
 * duration inside [startDate, endDate] (inclusive, YYYY-MM-DD), oldest
 * first. Patient-scoped; no fallback values — a night without a logged
 * duration is not a night. One row per date (latest updated_at wins —
 * the table carries no uniqueness constraint, so a hydrated server copy
 * can shadow a local row; same rule as getDailyLog).
 */
export async function getSleepNights(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<SleepNightRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<
    SleepNightRow & { log_date: string; updated_at: string }
  >(
    `SELECT log_date, sleep_duration_minutes, sleep_quality, sleep_awakenings, updated_at
     FROM daily_logs
     WHERE patient_id = ?
       AND log_date >= ? AND log_date <= ?
       AND sleep_duration_minutes IS NOT NULL
     ORDER BY updated_at DESC`,
    [patientId, startDate, endDate],
  );
  const seen = new Set<string>();
  const nights: SleepNightRow[] = [];
  for (const r of rows) {
    const day = r.log_date.slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    nights.push({
      log_date: day,
      sleep_duration_minutes: r.sleep_duration_minutes,
      sleep_quality: r.sleep_quality,
      sleep_awakenings: r.sleep_awakenings,
    });
  }
  return nights.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
}

export interface SleepTimeRow {
  log_date: string;
  bedtime: string | null;
  wake_time: string | null;
}
/**
 * Bounded bedtime/wake-time history for the Sleep Engine: validated clock
 * times from SLEEP_LOG event payloads inside [startDate, endDate].
 * One row per day (latest event wins); nights without clock times are
 * absent (never null-filled) so consistency math only sees real times.
 * Patient-scoped through the group's patient_id.
 */
export async function getSleepTimes(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<SleepTimeRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ log_date: string; payload_json: string; created_at: string }>(
    `SELECT g.log_date AS log_date, e.payload_json AS payload_json, e.created_at AS created_at
     FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ?
       AND e.event_type = 'SLEEP_LOG'
       AND g.log_date >= ? AND g.log_date <= ?
     ORDER BY g.log_date ASC, e.created_at DESC`,
    [patientId, startDate, endDate],
  );
  const seen = new Set<string>();
  const times: SleepTimeRow[] = [];
  for (const r of rows) {
    const day = r.log_date.slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    const payload = parseJsonPayload(r.payload_json);
    const bedtime = validClockOrNull(typeof payload.bedtime === 'string' ? payload.bedtime : null);
    const wakeTime = validClockOrNull(typeof payload.wake_time === 'string' ? payload.wake_time : null);
    if (bedtime === null && wakeTime === null) continue;
    times.push({ log_date: day, bedtime, wake_time: wakeTime });
  }
  return times;
}

export interface BpReadingRow {
  log_date: string;
  concept_id: string | null;
  value: number | null;
  unit: string | null;
}

/**
 * Bounded BP readings for the vitals display: VITAL_SIGN events inside
 * [startDate, endDate], oldest first. Pairing, plausibility, and
 * averaging happen in bloodPressure.ts — this returns raw rows only.
 */
export async function getBpReadings(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<BpReadingRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ log_date: string; concept_id: string | null; payload_json: string }>(
    `SELECT g.log_date AS log_date, e.concept_id AS concept_id, e.payload_json AS payload_json
     FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ?
       AND e.event_type = 'VITAL_SIGN'
       AND g.log_date >= ? AND g.log_date <= ?
     ORDER BY g.log_date ASC, e.created_at ASC`,
    [patientId, startDate, endDate],
  );
  const out: BpReadingRow[] = [];
  for (const r of rows) {
    const payload = parseJsonPayload(r.payload_json);
    const rawValue = payload.value;
    const value =
      typeof rawValue === 'string'
        ? Number(rawValue)
        : typeof rawValue === 'number'
          ? rawValue
          : null;
    out.push({
      log_date: r.log_date.slice(0, 10),
      concept_id: r.concept_id,
      value: value !== null && Number.isFinite(value) ? value : null,
      unit: typeof payload.unit === 'string' ? payload.unit : null,
    });
  }
  return out;
}

/**
 * Bounded daily symptom occurrences for pattern displays: SYMPTOM events
 * inside [startDate, endDate], oldest first. Patient-scoped through the
 * group's patient_id. Display names resolve separately through the
 * manual-log concepts endpoint (events carry concept ids only).
 */
export interface SymptomDayRow {
  log_date: string;
  concept_id: string | null;
  severity: number | null;
}

export async function getSymptomDays(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<SymptomDayRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ log_date: string; concept_id: string | null; payload_json: string }>(
    `SELECT g.log_date AS log_date, e.concept_id AS concept_id, e.payload_json AS payload_json
     FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ?
       AND e.event_type = 'SYMPTOM'
       AND g.log_date >= ? AND g.log_date <= ?
     ORDER BY g.log_date ASC, e.created_at ASC`,
    [patientId, startDate, endDate],
  );
  const out: SymptomDayRow[] = [];
  for (const r of rows) {
    const day = r.log_date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const payload = parseJsonPayload(r.payload_json);
    const severity =
      typeof payload.severity === 'number' && Number.isFinite(payload.severity)
        ? payload.severity
        : null;
    out.push({ log_date: day, concept_id: r.concept_id, severity });
  }
  return out;
}

/**
 * Bounded weight history for the Weight Engine: VITAL_SIGN events inside
 * [startDate, endDate] (inclusive, YYYY-MM-DD on the group's
 * log_date — the local calendar day the check-in belongs to), oldest
 * first. Patient-scoped through the group's patient_id.
 *
 * A weight vital is recognized by concept (LOINC 29463-7 or a weight
 * concept id) or by unit (kg/lb). Pounds convert to kilograms. One point
 * per day (latest entry wins); non-numeric and out-of-range values
 * (<=0 or >=500 kg) are dropped, never plotted as zero.
 */
export interface WeightHistoryPoint {
  log_date: string;
  weight_kg: number;
}

const LB_TO_KG = 0.45359237;

export async function getWeightHistory(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<WeightHistoryPoint[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    log_date: string;
    concept_id: string | null;
    payload_json: string;
    created_at: string;
  }>(
    `SELECT g.log_date AS log_date, e.concept_id AS concept_id,
            e.payload_json AS payload_json, e.created_at AS created_at
     FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ?
       AND e.event_type = 'VITAL_SIGN'
       AND g.log_date >= ? AND g.log_date <= ?
     ORDER BY g.log_date ASC, e.created_at ASC`,
    [patientId, startDate, endDate],
  );
  const latestByDay = new Map<string, number>();
  for (const r of rows) {
    const payload = parseJsonPayload(r.payload_json);
    const rawValue = payload.value;
    const value = typeof rawValue === 'string' ? Number(rawValue) : rawValue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
    const unit = typeof payload.unit === 'string' ? payload.unit.trim().toLowerCase() : '';
    const concept = (r.concept_id ?? '').toLowerCase();
    const isWeight =
      concept === '29463-7' ||
      concept.includes('weight') ||
      unit === 'kg' ||
      unit === 'kgs' ||
      unit === 'kilogram' ||
      unit === 'kilograms' ||
      unit === 'lb' ||
      unit === 'lbs' ||
      unit === 'pound' ||
      unit === 'pounds';
    if (!isWeight) continue;
    const kg = unit.startsWith('lb') || unit.startsWith('pound') ? value * LB_TO_KG : value;
    if (kg <= 0 || kg >= 500) continue;
    latestByDay.set(r.log_date.slice(0, 10), Math.round(kg * 10) / 10);
  }
  return [...latestByDay.entries()]
    .map(([log_date, weight_kg]) => ({ log_date, weight_kg }))
    .sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
}

/**
 * Bounded activity history for the Fitness Engine: ACTIVITY_LOG events
 * inside [startDate, endDate] (inclusive, YYYY-MM-DD on the group's
 * log_date — the local calendar day the check-in belongs to), oldest
 * first. Patient-scoped through the group's patient_id. duration_minutes
 * and calories_burned are user-logged and optional; a session without a
 * duration is still a session, never zero minutes.
 */
export interface ActivityLogRow {
  log_date: string;
  activity_type: string;
  duration_minutes: number | null;
  calories_burned: number | null;
  distance_km: number | null;
}

export async function getActivityLogs(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<ActivityLogRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ log_date: string; payload_json: string }>(
    `SELECT g.log_date AS log_date, e.payload_json AS payload_json
     FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ?
       AND e.event_type = 'ACTIVITY_LOG'
       AND g.log_date >= ? AND g.log_date <= ?
     ORDER BY g.log_date ASC, e.created_at ASC`,
    [patientId, startDate, endDate],
  );
  return rows.map((r) => {
    const payload = parseJsonPayload(r.payload_json);
    const duration =
      typeof payload.duration_minutes === 'number' && Number.isFinite(payload.duration_minutes)
        ? payload.duration_minutes
        : null;
    const calories =
      typeof payload.calories_burned === 'number' && Number.isFinite(payload.calories_burned)
        ? payload.calories_burned
        : null;
    const distanceKm =
      typeof payload.distance_km === 'number' &&
      Number.isFinite(payload.distance_km) &&
      payload.distance_km > 0
        ? Math.round(payload.distance_km * 100) / 100
        : null;
    return {
      log_date: r.log_date.slice(0, 10),
      activity_type:
        typeof payload.activity_type === 'string' && payload.activity_type.trim()
          ? payload.activity_type
          : 'Activity',
      duration_minutes: duration,
      calories_burned: calories,
      distance_km: distanceKm,
    };
  });
}
/**
 * Bounded nutrition history for the Nutrition Engine: group-level meal
 * columns inside [startDate, endDate] (inclusive, YYYY-MM-DD), oldest
 * first. Patient-scoped. Only days with at least one nutrition field are
 * returned — a day without logged meals, estimated calories, or a food
 * label is not a nutrition day. calories_kcal on this device is written
 * only by the food-scan flow (AI-estimated, summed per day); macros are
 * not persisted anywhere and are therefore not returned here.
 */
export interface NutritionDayRow {
  log_date: string;
  meals_count: number | null;
  calories_kcal: number | null;
  food_label: string | null;
}

export async function getNutritionDays(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<NutritionDayRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NutritionDayRow & { updated_at: string }>(
    `SELECT log_date, meals_count, calories_kcal, food_label, updated_at
     FROM daily_logs
     WHERE patient_id = ?
       AND log_date >= ? AND log_date <= ?
       AND (meals_count IS NOT NULL OR calories_kcal IS NOT NULL OR food_label IS NOT NULL)
     ORDER BY updated_at DESC`,
    [patientId, startDate, endDate],
  );
  // One row per date (latest updated_at wins — see getSleepNights).
  const seen = new Set<string>();
  const days: NutritionDayRow[] = [];
  for (const r of rows) {
    const day = r.log_date.slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    days.push({
      log_date: day,
      meals_count: r.meals_count,
      calories_kcal: r.calories_kcal,
      food_label: r.food_label,
    });
  }
  return days.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
}
/**
 * Bounded wellbeing history for the Wellbeing Engine: group-level
 * user-entered 1–5 ratings inside [startDate, endDate] (inclusive,
 * YYYY-MM-DD), oldest first. Patient-scoped. Only days with at least one
 * rating are returned — a day without mood, energy, or stress is not a
 * wellbeing day. No questionnaires, journals, or inferred signals exist
 * on device, so none are returned here.
 */
export interface WellbeingDayRow {
  log_date: string;
  overall_wellbeing: number | null;
  energy_level: number | null;
  stress_level: number | null;
}

export async function getWellbeingDays(
  patientId: string,
  startDate: string,
  endDate: string,
): Promise<WellbeingDayRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<WellbeingDayRow & { updated_at: string }>(
    `SELECT log_date, overall_wellbeing, energy_level, stress_level, updated_at
     FROM daily_logs
     WHERE patient_id = ?
       AND log_date >= ? AND log_date <= ?
       AND (overall_wellbeing IS NOT NULL OR energy_level IS NOT NULL OR stress_level IS NOT NULL)
     ORDER BY updated_at DESC`,
    [patientId, startDate, endDate],
  );
  // One row per date (latest updated_at wins — see getSleepNights).
  const seen = new Set<string>();
  const days: WellbeingDayRow[] = [];
  for (const r of rows) {
    const day = r.log_date.slice(0, 10);
    if (seen.has(day)) continue;
    seen.add(day);
    days.push({
      log_date: day,
      overall_wellbeing: r.overall_wellbeing,
      energy_level: r.energy_level,
      stress_level: r.stress_level,
    });
  }
  return days.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
}
/**
 * Get all events for a daily log group, scoped to patient via the group's patient_id.
 */
export async function getDailyLogEvents(
  patientId: string,
  groupId: string,
): Promise<DailyLogEventRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<DailyLogEventRow>(
    `SELECT e.* FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE g.patient_id = ? AND e.group_id = ?
     ORDER BY e.event_type, e.created_at`,
    [patientId, groupId],
  );
}

/**
 * Get a daily log with all its events, reconstructed as DailyCheckInDetail.
 * This is the primary read method for the UI.
 */
export async function getDailyLogDetail(
  patientId: string,
  date: string,
): Promise<DailyCheckInDetail | null> {
  const log = await getDailyLog(patientId, date);
  if (!log) return null;

  const events = await getDailyLogEvents(patientId, log.group_id);
  return reconstructDetail(log, events);
}

// ─── Write Operations ────────────────────────────────────────────────────────

/**
 * Upsert a daily log and its events in a single transaction.
 *
 * If a log already exists for this patient+date, it and its events are replaced.
 * If no log exists, a new one is created.
 *
 * Returns the group_id.
 */
export async function upsertDailyLog(
  patientId: string,
  request: DailyCheckInRequest,
): Promise<string> {
  const db = await getDatabase();
  const now = nowIso();

  // Check for existing log on this date
  const existing = await getDailyLog(patientId, request.log_date);
  const groupId = existing?.group_id ?? generateLocalId();

  // Post-commit announcement count: declared outside the transaction because
  // the announce loop runs after commit (one announcement per queue entry,
  // preserving the previous behavior).
  let queued = 0;

  await withSerializedTransaction(db, async () => {
    // Upsert the daily_logs row
    await db.runAsync(
      `INSERT INTO daily_logs (
        group_id, patient_id, log_date,
        overall_wellbeing, energy_level, stress_level,
        sleep_duration_minutes, sleep_quality, sleep_awakenings,
        water_ml, meals_count, appetite_level,
        calories_kcal, food_label,
        notes, created_at, updated_at,
        local_id, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')
      ON CONFLICT(group_id) DO UPDATE SET
        overall_wellbeing = excluded.overall_wellbeing,
        energy_level = excluded.energy_level,
        stress_level = excluded.stress_level,
        sleep_duration_minutes = excluded.sleep_duration_minutes,
        sleep_quality = excluded.sleep_quality,
        sleep_awakenings = excluded.sleep_awakenings,
        water_ml = excluded.water_ml,
        meals_count = excluded.meals_count,
        appetite_level = excluded.appetite_level,
        calories_kcal = excluded.calories_kcal,
        food_label = excluded.food_label,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        sync_status = CASE WHEN sync_status = 'synced' THEN 'pending_update' ELSE sync_status END`,
      [
        groupId,
        patientId,
        request.log_date,
        request.overall_wellbeing ?? null,
        request.energy_level ?? null,
        request.stress_level ?? null,
        request.sleep?.duration_minutes ?? null,
        request.sleep?.sleep_quality ?? null,
        request.sleep?.awakenings ?? null,
        request.nutrition?.water_ml ?? null,
        request.nutrition?.meals_count ?? null,
        request.nutrition?.appetite_level ?? null,
        request.nutrition?.calories_kcal ?? null,
        request.nutrition?.food_label ?? null,
        request.notes ?? null,
        existing?.created_at ?? now,
        now,
        existing?.local_id ?? groupId,
      ],
    );

    // Delete existing events for this group (replace strategy)
    await db.runAsync(
      'DELETE FROM daily_log_events WHERE group_id = ?',
      [groupId],
    );

    // Insert all events
    const eventTime = `${request.log_date}T12:00:00.000Z`;
    const events = buildEventsFromRequest(request, groupId, eventTime, now);

    for (const event of events) {
      await db.runAsync(
        `INSERT INTO daily_log_events (
          event_id, group_id, event_type, concept_id,
          event_time, payload_json, created_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
        [
          event.event_id,
          event.group_id,
          event.event_type,
          event.concept_id,
          event.event_time,
          JSON.stringify(event.payload_json),
          now,
        ],
      );
    }

    // Add sync_queue entries (same transaction as the rows above).
    // Side effects fire after commit below (announceQueueWrite), preserving
    // the previous one-announcement-per-entry behavior.
    const hasServerGroupId = existing?.sync_status === 'synced';
    await writeQueueRow(db, patientId, 'daily_logs', groupId, hasServerGroupId ? 'update' : 'create', {
      group_id: groupId,
      patient_id: patientId,
      log_date: request.log_date,
      overall_wellbeing: request.overall_wellbeing ?? null,
      energy_level: request.energy_level ?? null,
      stress_level: request.stress_level ?? null,
      sleep: request.sleep ?? null,
      nutrition: request.nutrition ?? null,
      notes: request.notes ?? null,
      symptoms: request.symptoms ?? null,
      vitals: request.vitals ?? null,
      pain: request.pain ?? null,
      activities: request.activities ?? null,
      medications: request.medications ?? null,
    });
    queued += 1;

    for (const event of events) {
      await writeQueueRow(db, patientId, 'daily_log_events', event.event_id, 'create', {
        event_id: event.event_id,
        group_id: groupId,
        event_type: event.event_type,
      });
      queued += 1;
    }
  });
  for (let i = 0; i < queued; i++) announceQueueWrite();

  return groupId;
}

/**
 * Partial overlay for merging into a day without wiping it.
 * upsertDailyLog has REPLACE semantics (absent scalars become null, all
 * events are rebuilt), so pulse readings and voice answers must never
 * write partial payloads directly — they merge through here instead.
 */
export interface DailyLogOverlay {
  overall_wellbeing?: number;
  energy_level?: number;
  stress_level?: number;
  sleep_minutes?: number;
  water_ml?: number;
  vitals?: { concept_id: string; value: number; unit: string }[];
  pain?: { severity: number }[];
  /** Bedtime 'HH:MM' — wins over the day's existing value, never wipes. */
  bedtime?: string;
  /** Wake time 'HH:MM' — wins over the day's existing value, never wipes. */
  wake_time?: string;
  /** Journal transcript appended to the day's notes (capped, never wiped). */
  notes_append?: string;
}

/**
 * Build a complete check-in request from an existing detail (local or
 * server — same shape) plus an overlay. Every existing scalar and event
 * survives; overlay scalars win; overlay vitals replace same-concept
 * entries (one reading per concept per day); overlay pain appends.
 * Null detail (no log yet) yields an overlay-only request.
 */
export function buildCheckinRequestFromDetail(
  logDate: string,
  detail: DailyCheckInDetail | null,
  overlay: DailyLogOverlay,
): DailyCheckInRequest {
  const replacedConcepts = new Set((overlay.vitals ?? []).map((v) => v.concept_id));
  const vitals: DailyCheckInRequest['vitals'] = [
    ...(detail?.vitals ?? [])
      .filter((v) => v.concept_id != null && !replacedConcepts.has(v.concept_id))
      .map((v) => ({
        concept_id: v.concept_id as string,
        value: v.value,
        unit: v.unit,
      })),
    ...(overlay.vitals ?? []),
  ];
  const wellbeing = overlay.overall_wellbeing ?? detail?.overall_wellbeing ?? null;
  const energy = overlay.energy_level ?? detail?.energy_level ?? null;
  const stress = overlay.stress_level ?? detail?.stress_level ?? null;
  // Sleep merges overlay-first like the other scalars: an overlay value wins,
  // otherwise the day's existing duration survives (never wiped by a partial write).
  // Bedtime/wake ride along the same way — validated clock times only, and
  // they live in the SLEEP_LOG event payload (never in the synced scalar).
  const sleepMinutes = overlay.sleep_minutes ?? detail?.sleep_duration_minutes ?? null;
  const bedtime =
    validClockOrNull(overlay.bedtime) ??
    validClockOrNull(detail?.bedtime ?? null) ??
    null;
  const wakeTime =
    validClockOrNull(overlay.wake_time) ??
    validClockOrNull(detail?.wake_time ?? null) ??
    null;
  // Nutrition merges field-by-field: a water top-up must never wipe meals.
  const nutrition: NonNullable<DailyCheckInRequest['nutrition']> = {
    ...(detail?.water_ml != null ? { water_ml: detail.water_ml } : {}),
    ...(detail?.meals_count != null ? { meals_count: detail.meals_count } : {}),
    ...(detail?.appetite_level != null ? { appetite_level: detail.appetite_level } : {}),
    ...(detail?.calories_kcal != null ? { calories_kcal: detail.calories_kcal } : {}),
    ...(detail?.food_label ? { food_label: detail.food_label } : {}),
    ...(overlay.water_ml != null ? { water_ml: overlay.water_ml } : {}),
  };
  const hasNutrition = Object.keys(nutrition).length > 0;
  // Journal transcripts append to the day's notes (capped); existing notes
  // are never cut to make room — buildNotesAppend keeps them intact.
  const notes = buildNotesAppend(
    detail?.notes ?? null,
    overlay.notes_append ?? '',
  );
  return {
    log_date: logDate,
    ...(wellbeing != null ? { overall_wellbeing: wellbeing } : {}),
    ...(energy != null ? { energy_level: energy } : {}),
    ...(stress != null ? { stress_level: stress } : {}),
    ...(sleepMinutes != null
      ? {
          sleep: {
            duration_minutes: sleepMinutes,
            ...(detail?.sleep_quality != null ? { sleep_quality: detail.sleep_quality } : {}),
            ...(detail?.sleep_awakenings != null ? { awakenings: detail.sleep_awakenings } : {}),
            ...(bedtime != null ? { bedtime } : {}),
            ...(wakeTime != null ? { wake_time: wakeTime } : {}),
          },
        }
      : {}),
    ...(hasNutrition ? { nutrition } : {}),
    ...(notes ? { notes } : {}),
    symptoms: (detail?.symptoms ?? []).map((s) => ({
      concept_id: s.concept_id ?? '',
      severity: s.severity,
      ...(s.duration_minutes != null ? { duration_minutes: s.duration_minutes } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
    })),
    vitals,
    pain: [
      ...(detail?.pain ?? []).map((p) => ({
        severity: p.severity,
        ...(p.body_location_id ? { body_location_id: p.body_location_id } : {}),
        ...(p.pain_type ? { pain_type: p.pain_type } : {}),
      })),
      ...(overlay.pain ?? []),
    ],
    activities: (detail?.activities ?? []).map((a) => ({
      activity_type: a.activity_type,
      ...(a.duration_minutes != null ? { duration_minutes: a.duration_minutes } : {}),
      ...(a.calories_burned != null ? { calories_burned: a.calories_burned } : {}),
      ...(a.distance_km != null ? { distance_km: a.distance_km } : {}),
    })),
    medications: (detail?.medications ?? []).map((m) => ({
      medication_name: m.medication_name,
      ...(m.dosage_value != null ? { dosage_value: m.dosage_value } : {}),
      ...(m.dosage_unit ? { dosage_unit: m.dosage_unit } : {}),
    })),
  };
}

/**
 * Merge an overlay into a day's local log, losslessly. Returns the group id.
 * Pain lands in pain, vitals in vitals, water in nutrition — every other
 * slot keeps exactly what the day already had.
 */
export async function mergeIntoDailyLog(
  patientId: string,
  logDate: string,
  overlay: DailyLogOverlay,
): Promise<string> {
  const existing = await getDailyLogDetail(patientId, logDate).catch(() => null);
  const request = buildCheckinRequestFromDetail(logDate, existing, overlay);
  return upsertDailyLog(patientId, request);
}

/**
 * Insert a single daily log event.
 */
export async function insertDailyLogEvent(
  patientId: string,
  groupId: string,
  eventType: DailyLogEventType,
  conceptId: string | null,
  eventTime: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const db = await getDatabase();
  const localId = generateLocalId();
  const now = nowIso();

  // Verify group belongs to patient
  const group = await db.getFirstAsync<{ group_id: string }>(
    'SELECT group_id FROM daily_logs WHERE group_id = ? AND patient_id = ?',
    [groupId, patientId],
  );
  if (!group) throw new Error('Daily log group not found');

  // Atomic: event row + queue entry commit together.
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `INSERT INTO daily_log_events (
      event_id, group_id, event_type, concept_id,
      event_time, payload_json, created_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
      [localId, groupId, eventType, conceptId, eventTime, JSON.stringify(payload), now],
    );

    await writeQueueRow(db, patientId, 'daily_log_events', localId, 'create', {
      event_id: localId,
      group_id: groupId,
      event_type: eventType,
    });
  });
  announceQueueWrite();

  return localId;
}

/**
 * Update a single daily log event's payload.
 */
export async function updateDailyLogEvent(
  patientId: string,
  eventId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  // Verify event belongs to patient via group
  const event = await db.getFirstAsync<{ group_id: string }>(
    `SELECT e.group_id FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE e.event_id = ? AND g.patient_id = ?`,
    [eventId, patientId],
  );
  if (!event) return;

  // Atomic: event update + queue entry commit together.
  await withSerializedTransaction(db, async () => {
    await db.runAsync(
      `UPDATE daily_log_events
      SET payload_json = ?, sync_status = 'pending_update'
      WHERE event_id = ?`,
      [JSON.stringify(payload), eventId],
    );

    await writeQueueRow(db, patientId, 'daily_log_events', eventId, 'update', {
      event_id: eventId,
      group_id: event.group_id,
    });
  });
  announceQueueWrite();
}

/**
 * Delete a daily log event.
 */
export async function deleteDailyLogEvent(
  patientId: string,
  eventId: string,
): Promise<void> {
  const db = await getDatabase();

  // Verify event belongs to patient via group
  const event = await db.getFirstAsync<{ group_id: string; sync_status: string }>(
    `SELECT e.group_id, e.sync_status FROM daily_log_events e
     INNER JOIN daily_logs g ON e.group_id = g.group_id
     WHERE e.event_id = ? AND g.patient_id = ?`,
    [eventId, patientId],
  );
  if (!event) return;

  if (event.sync_status === 'pending_create') {
    // Never synced — safe to remove
    await db.runAsync(
      'DELETE FROM daily_log_events WHERE event_id = ?',
      [eventId],
    );
  } else {
    // Synced — soft delete (row + queue entry commit together)
    await withSerializedTransaction(db, async () => {
      await db.runAsync(
        "UPDATE daily_log_events SET sync_status = 'pending_delete' WHERE event_id = ?",
        [eventId],
      );
      await writeQueueRow(db, patientId, 'daily_log_events', eventId, 'delete', null);
    });
    announceQueueWrite();
  }
}

// ─── Hydration ───────────────────────────────────────────────────────────────

/**
 * Hydrate a daily log from server data.
 * Preserves locally pending mutations.
 */
export async function hydrateDailyLog(
  patientId: string,
  detail: DailyCheckInDetail,
): Promise<void> {
  const db = await getDatabase();
  const now = nowIso();

  // Check if local pending mutation exists
  const existing = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM daily_logs WHERE group_id = ?',
    [detail.group_id],
  );

  if (existing && existing.sync_status !== 'synced') {
    // Skip — local mutation takes priority
    return;
  }

  await withSerializedTransaction(db, async () => {
    // Upsert the daily_logs row
    await db.runAsync(
      `INSERT INTO daily_logs (
        group_id, patient_id, log_date,
        overall_wellbeing, energy_level, stress_level,
        sleep_duration_minutes, sleep_quality, sleep_awakenings,
        water_ml, meals_count, appetite_level,
        calories_kcal, food_label,
        notes, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
      ON CONFLICT(group_id) DO UPDATE SET
        patient_id = excluded.patient_id,
        log_date = excluded.log_date,
        overall_wellbeing = excluded.overall_wellbeing,
        energy_level = excluded.energy_level,
        stress_level = excluded.stress_level,
        sleep_duration_minutes = excluded.sleep_duration_minutes,
        sleep_quality = excluded.sleep_quality,
        sleep_awakenings = excluded.sleep_awakenings,
        water_ml = excluded.water_ml,
        meals_count = excluded.meals_count,
        appetite_level = excluded.appetite_level,
        calories_kcal = excluded.calories_kcal,
        food_label = excluded.food_label,
        notes = excluded.notes,
        updated_at = excluded.updated_at,
        sync_status = 'synced'
      WHERE sync_status = 'synced'`,
      [
        detail.group_id,
        patientId,
        detail.log_date,
        detail.overall_wellbeing,
        detail.energy_level,
        detail.stress_level,
        detail.sleep_duration_minutes,
        detail.sleep_quality,
        detail.sleep_awakenings,
        detail.water_ml,
        detail.meals_count,
        detail.appetite_level,
        detail.calories_kcal,
        detail.food_label,
        detail.notes,
        now,
        now,
      ],
    );

    // Delete existing synced events and re-insert
    await db.runAsync(
      "DELETE FROM daily_log_events WHERE group_id = ? AND sync_status = 'synced'",
      [detail.group_id],
    );

    // Build and insert events from the detail
    const eventTime = `${detail.log_date}T12:00:00.000Z`;
    const events = buildEventsFromDetail(detail, eventTime, now);

    for (const event of events) {
      await db.runAsync(
        `INSERT INTO daily_log_events (
          event_id, group_id, event_type, concept_id,
          event_time, payload_json, created_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'synced')`,
        [
          event.event_id,
          event.group_id,
          event.event_type,
          event.concept_id,
          event.event_time,
          JSON.stringify(event.payload_json),
          now,
        ],
      );
    }
  });
}

// ─── Local Schedule Computation ──────────────────────────────────────────────

/**
 * Compute today's daily log summary locally.
 * Returns basic metrics for the dashboard without server roundtrip.
 */
export async function computeLocalDailyMetrics(
  patientId: string,
): Promise<{
  today_wellbeing: { overall_wellbeing: number | null; energy_level: number | null; stress_level: number | null } | null;
  latest_sleep: { duration_minutes: number; sleep_quality: number | null; awakenings: number | null } | null;
  recent_daily_logs: Array<{ log_date: string; event_count: number; categories: string[] }>;
} | null> {
  const db = await getDatabase();
  const today = todayLocalDateString();

  const log = await getDailyLog(patientId, today);
  if (!log) return null;

  const events = await getDailyLogEvents(patientId, log.group_id);

  // Build wellbeing summary
  const wellbeing = (log.overall_wellbeing != null || log.energy_level != null || log.stress_level != null)
    ? {
        overall_wellbeing: log.overall_wellbeing,
        energy_level: log.energy_level,
        stress_level: log.stress_level,
      }
    : null;

  // Build sleep summary from events
  let sleep: { duration_minutes: number; sleep_quality: number | null; awakenings: number | null } | null = null;
  const sleepEvent = events.find(e => e.event_type === 'SLEEP_LOG');
  if (sleepEvent) {
    const payload = parseJsonPayload(sleepEvent.payload_json);
    sleep = {
      duration_minutes: payload.duration_minutes as number ?? 0,
      sleep_quality: payload.sleep_quality as number ?? null,
      awakenings: payload.awakenings as number ?? null,
    };
  }

  // Get recent logs count
  const recentLogs = await db.getAllAsync<{ log_date: string; event_count: number }>(
    `SELECT log_date, (
       SELECT COUNT(*) FROM daily_log_events WHERE group_id = g.group_id
     ) as event_count
     FROM daily_logs g
     WHERE patient_id = ?
     ORDER BY log_date DESC
     LIMIT 7`,
    [patientId],
  );

  return {
    today_wellbeing: wellbeing,
    latest_sleep: sleep,
    recent_daily_logs: recentLogs.map(r => ({
      log_date: r.log_date,
      event_count: r.event_count,
      categories: [], // Categories would require joining event types
    })),
  };
}

// ─── Event Building ──────────────────────────────────────────────────────────

interface BuiltEvent {
  event_id: string;
  group_id: string;
  event_type: DailyLogEventType;
  concept_id: string | null;
  event_time: string;
  payload_json: Record<string, unknown>;
}

/**
 * Build event rows from a DailyCheckInRequest.
 * Mirrors the backend's event creation logic.
 */
function buildEventsFromRequest(
  request: DailyCheckInRequest,
  groupId: string,
  eventTime: string,
  now: string,
): BuiltEvent[] {
  const events: BuiltEvent[] = [];

  // Wellbeing
  if (request.overall_wellbeing != null || request.energy_level != null || request.stress_level != null) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'WELLBEING_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        overall_wellbeing: request.overall_wellbeing ?? null,
        energy_level: request.energy_level ?? null,
        stress_level: request.stress_level ?? null,
      },
    });
  }

  // Symptoms
  for (const symptom of request.symptoms) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'SYMPTOM',
      concept_id: symptom.concept_id,
      event_time: eventTime,
      payload_json: {
        severity: symptom.severity,
        duration_minutes: symptom.duration_minutes ?? null,
        notes: symptom.notes ?? null,
      },
    });
  }

  // Vitals
  for (const vital of request.vitals) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'VITAL_SIGN',
      concept_id: vital.concept_id,
      event_time: eventTime,
      payload_json: {
        value: vital.value,
        unit: vital.unit,
      },
    });
  }

  // Pain
  for (const pain of request.pain) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'PAIN_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        severity: pain.severity,
        body_location_id: pain.body_location_id ?? null,
        structure_id: pain.structure_id ?? null,
        pain_type: pain.pain_type ?? null,
      },
    });
  }

  // Sleep
  if (request.sleep) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'SLEEP_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        duration_minutes: request.sleep.duration_minutes,
        sleep_quality: request.sleep.sleep_quality ?? null,
        awakenings: request.sleep.awakenings ?? null,
        // Optional clock times ride the event payload only (validated);
        // the synced sleep scalar stays duration/quality/awakenings.
        ...(validClockOrNull(request.sleep.bedtime) != null
          ? { bedtime: request.sleep.bedtime }
          : {}),
        ...(validClockOrNull(request.sleep.wake_time) != null
          ? { wake_time: request.sleep.wake_time }
          : {}),
      },
    });
  }

  // Activities
  for (const activity of request.activities) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'ACTIVITY_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        activity_type: activity.activity_type,
        duration_minutes: activity.duration_minutes ?? null,
        calories_burned: activity.calories_burned ?? null,
        ...(activity.distance_km ?? null) !== null
          ? { distance_km: activity.distance_km }
          : {},
      },
    });
  }

  // Nutrition
  if (request.nutrition) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'NUTRITION_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        water_ml: request.nutrition.water_ml ?? null,
        meals_count: request.nutrition.meals_count ?? null,
        appetite_level: request.nutrition.appetite_level ?? null,
        calories_kcal: request.nutrition.calories_kcal ?? null,
        food_label: request.nutrition.food_label ?? null,
      },
    });
  }

  // Medications
  for (const med of request.medications) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'MEDICATION_TAKEN',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        medication_name: med.medication_name,
        dosage_value: med.dosage_value ?? null,
        dosage_unit: med.dosage_unit ?? null,
      },
    });
  }

  // Notes
  if (request.notes) {
    events.push({
      event_id: generateLocalId(),
      group_id: groupId,
      event_type: 'PATIENT_NOTE',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        safe_notes: request.notes,
      },
    });
  }

  return events;
}

/**
 * Build event rows from a DailyCheckInDetail (server response).
 */
function buildEventsFromDetail(
  detail: DailyCheckInDetail,
  eventTime: string,
  now: string,
): BuiltEvent[] {
  const events: BuiltEvent[] = [];

  // Wellbeing
  if (detail.overall_wellbeing != null || detail.energy_level != null || detail.stress_level != null) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'WELLBEING_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        overall_wellbeing: detail.overall_wellbeing,
        energy_level: detail.energy_level,
        stress_level: detail.stress_level,
      },
    });
  }

  // Symptoms
  for (const symptom of detail.symptoms) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'SYMPTOM',
      concept_id: symptom.concept_id,
      event_time: eventTime,
      payload_json: {
        severity: symptom.severity,
        duration_minutes: symptom.duration_minutes,
        notes: symptom.notes,
      },
    });
  }

  // Vitals
  for (const vital of detail.vitals) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'VITAL_SIGN',
      concept_id: vital.concept_id,
      event_time: eventTime,
      payload_json: {
        value: vital.value,
        unit: vital.unit,
      },
    });
  }

  // Pain
  for (const pain of detail.pain) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'PAIN_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        severity: pain.severity,
        body_location_id: pain.body_location_id,
        pain_type: pain.pain_type,
      },
    });
  }

  // Sleep
  if (detail.sleep_duration_minutes != null) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'SLEEP_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        duration_minutes: detail.sleep_duration_minutes,
        sleep_quality: detail.sleep_quality,
        awakenings: detail.sleep_awakenings,
      },
    });
  }

  // Activities
  for (const activity of detail.activities) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'ACTIVITY_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        activity_type: activity.activity_type,
        duration_minutes: activity.duration_minutes,
        calories_burned: activity.calories_burned,
        ...(activity.distance_km != null ? { distance_km: activity.distance_km } : {}),
      },
    });
  }

  // Nutrition
  if (detail.water_ml != null || detail.meals_count != null || detail.appetite_level != null || detail.calories_kcal != null || detail.food_label != null) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'NUTRITION_LOG',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        water_ml: detail.water_ml,
        meals_count: detail.meals_count,
        appetite_level: detail.appetite_level,
        calories_kcal: detail.calories_kcal,
        food_label: detail.food_label,
      },
    });
  }

  // Medications
  for (const med of detail.medications) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'MEDICATION_TAKEN',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        medication_name: med.medication_name,
        dosage_value: med.dosage_value,
        dosage_unit: med.dosage_unit,
      },
    });
  }

  // Notes
  if (detail.notes) {
    events.push({
      event_id: generateLocalId(),
      group_id: detail.group_id,
      event_type: 'PATIENT_NOTE',
      concept_id: null,
      event_time: eventTime,
      payload_json: {
        safe_notes: detail.notes,
      },
    });
  }

  return events;
}

/**
 * Reconstruct a DailyCheckInDetail from local SQLite rows.
 */
function reconstructDetail(
  log: DailyLogRow,
  events: DailyLogEventRow[],
): DailyCheckInDetail {
  const symptoms: DailyCheckInDetail['symptoms'] = [];
  const vitals: DailyCheckInDetail['vitals'] = [];
  const pain: DailyCheckInDetail['pain'] = [];
  const activities: DailyCheckInDetail['activities'] = [];
  const medications: DailyCheckInDetail['medications'] = [];

  let sleep_duration_minutes: number | null = null;
  let sleep_quality: number | null = null;
  let sleep_awakenings: number | null = null;
  let bedtime: string | null = null;
  let wake_time: string | null = null;
  let water_ml: number | null = null;
  let meals_count: number | null = null;
  let appetite_level: number | null = null;
  let calories_kcal: number | null = null;
  let food_label: string | null = null;
  let notes: string | null = null;

  for (const event of events) {
    const payload = parseJsonPayload(event.payload_json);

    switch (event.event_type) {
      case 'SYMPTOM':
        symptoms.push({
          concept_id: event.concept_id,
          severity: payload.severity as number,
          duration_minutes: payload.duration_minutes as number ?? null,
          notes: payload.notes as string ?? null,
        });
        break;

      case 'VITAL_SIGN':
        vitals.push({
          concept_id: event.concept_id,
          value: payload.value as number ?? null,
          unit: payload.unit as string ?? null,
        });
        break;

      case 'PAIN_LOG':
        pain.push({
          body_location_id: payload.body_location_id as string ?? null,
          severity: payload.severity as number,
          pain_type: payload.pain_type as string ?? null,
        });
        break;

      case 'SLEEP_LOG':
        sleep_duration_minutes = payload.duration_minutes as number ?? null;
        sleep_quality = payload.sleep_quality as number ?? null;
        sleep_awakenings = payload.awakenings as number ?? null;
        bedtime = validClockOrNull(payload.bedtime as string | null) ?? null;
        wake_time = validClockOrNull(payload.wake_time as string | null) ?? null;
        break;

      case 'ACTIVITY_LOG':
        activities.push({
          activity_type: payload.activity_type as string,
          duration_minutes: payload.duration_minutes as number ?? null,
          calories_burned: payload.calories_burned as number ?? null,
          distance_km:
            typeof payload.distance_km === 'number' && Number.isFinite(payload.distance_km)
              ? payload.distance_km
              : null,
        });
        break;

      case 'NUTRITION_LOG':
        water_ml = payload.water_ml as number ?? null;
        meals_count = payload.meals_count as number ?? null;
        appetite_level = payload.appetite_level as number ?? null;
        calories_kcal = payload.calories_kcal as number ?? null;
        food_label = (payload.food_label as string | null) ?? null;
        break;

      case 'MEDICATION_TAKEN':
        medications.push({
          medication_name: payload.medication_name as string,
          dosage_value: payload.dosage_value as number ?? null,
          dosage_unit: payload.dosage_unit as string ?? null,
        });
        break;

      case 'PATIENT_NOTE':
        notes = payload.safe_notes as string ?? null;
        break;
    }
  }

  // Group-level columns are the fallback when no NUTRITION_LOG event
  // exists (e.g. a row written before events were rebuilt).
  if (water_ml == null && log.water_ml != null) water_ml = log.water_ml;
  if (meals_count == null && log.meals_count != null) meals_count = log.meals_count;
  if (appetite_level == null && log.appetite_level != null) appetite_level = log.appetite_level;
  if (calories_kcal == null && log.calories_kcal != null) calories_kcal = log.calories_kcal;
  if (food_label == null && log.food_label != null) food_label = log.food_label;

  return {
    group_id: log.group_id,
    log_date: log.log_date,
    overall_wellbeing: log.overall_wellbeing,
    energy_level: log.energy_level,
    stress_level: log.stress_level,
    sleep_duration_minutes,
    sleep_quality,
    sleep_awakenings,
    bedtime,
    wake_time,
    water_ml,
    meals_count,
    appetite_level,
    calories_kcal,
    food_label,
    symptoms,
    vitals,
    pain,
    activities,
    medications,
    notes,
  };
}

// ─── Sync Queue ──────────────────────────────────────────────────────────────

type SyncDb = Awaited<ReturnType<typeof getDatabase>>;

/**
 * Queue-row SQL only (no side effects): safe to call INSIDE a serialized
 * transaction alongside the row writes. Side effects (badge + engine
 * trigger) go through announceQueueWrite() AFTER the transaction commits.
 */
async function writeQueueRow(
  db: SyncDb,
  patientId: string,
  tableName: string,
  recordId: string,
  operation: 'create' | 'update' | 'delete',
  payload: Record<string, unknown> | null,
): Promise<void> {
  // Generate a unique mutation_id for this specific mutation
  // This is distinct from record_id (business record ID)
  // For Daily Log UPDATE, multiple mutations can target the same group_id
  const mutationId = `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[DailyLog] QUEUE_START table=${tableName} op=${operation}`);
  try {
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM sync_queue WHERE table_name = ? AND record_id = ? AND status = ?',
      [tableName, recordId, 'pending'],
    );

    if (existing) {
      // Rotate the mutation_id: the sync engine uses it as the
      // Idempotency-Key, and the server 409s when a reused key carries a
      // different payload hash. A coalesced edit IS a different payload,
      // so it needs a fresh key. Heal ownership for legacy rows.
      await db.runAsync(
        "UPDATE sync_queue SET operation = ?, mutation_id = ?, payload_json = ?, created_at = datetime('now'), patient_id = COALESCE(patient_id, ?) WHERE id = ?",
        [operation, mutationId, payload ? JSON.stringify(payload) : null, patientId, existing.id],
      );
    } else {
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json, patient_id) VALUES (?, ?, ?, ?, ?, ?)',
        [tableName, recordId, mutationId, operation, payload ? JSON.stringify(payload) : null, patientId],
      );
    }
  } catch (error) {
    if (__DEV__) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[DailyLog] QUEUE_FAILURE table=${tableName} op=${operation} detail=${detail}`);
    } else {
      console.error(`[DailyLog] QUEUE_FAILURE table=${tableName} op=${operation}`);
    }
    throw error;
  }
  console.log(`[DailyLog] QUEUE_SUCCESS table=${tableName} op=${operation}`);
}

/** Post-commit side effects for queued mutations (badge + engine trigger). */
function announceQueueWrite(): void {
  // Mark mutation as queued for UI display
  import('@/services/syncState').then(({ markMutationQueued }) => {
    markMutationQueued();
  });

  // Trigger sync asynchronously (fire-and-forget)
  // The sync engine's mutex prevents concurrent execution
  triggerSync();
}

// Trigger sync asynchronously after local mutation
function triggerSync(): void {
  import('@/services/syncEngine').then(({ syncPendingMutations }) => {
    syncPendingMutations().catch(() => {});
  });
}

/**
 * Returns the mutation_id of the pending sync_queue row for a record, if any.
 * The daily-log screen shares this id as the Idempotency-Key on its direct
 * POST/PUT so a racing sync-engine POST cannot create a duplicate check-in.
 */
export async function getPendingMutationId(
  tableName: string,
  recordId: string,
): Promise<string | null> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ mutation_id: string }>(
      'SELECT mutation_id FROM sync_queue WHERE table_name = ? AND record_id = ? AND status = ?',
      [tableName, recordId, 'pending'],
    );
    return row?.mutation_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Reconciles a locally-created daily log with the server check-in created by
 * the screen's direct POST: points local rows at the server group_id, marks
 * the local record synced, and retires the now-redundant queued create so the
 * sync engine does not POST it a second time. All steps are best-effort.
 */
export async function reconcileDailyLogGroupId(
  localGroupId: string,
  serverGroupId: string,
): Promise<void> {
  if (!localGroupId || !serverGroupId || localGroupId === serverGroupId) return;
  try {
    const db = await getDatabase();
    await db.runAsync(
      `UPDATE daily_logs SET group_id = ?, sync_status = 'synced' WHERE group_id = ?`,
      [serverGroupId, localGroupId],
    );
    await db.runAsync(
      `UPDATE daily_log_events SET group_id = ? WHERE group_id = ?`,
      [serverGroupId, localGroupId],
    );
    await db.runAsync(
      `UPDATE sync_queue SET status = 'completed', last_error = NULL
       WHERE table_name = 'daily_logs' AND record_id = ? AND status = 'pending'`,
      [localGroupId],
    );
  } catch {
    // Best-effort: the sync engine will converge on the next pass.
  }
}
