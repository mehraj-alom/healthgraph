/**
 * dailyLogs.ts — Local SQLite repository for Daily Log entities.
 *
 * Maps the DailyCheckInRequest/Response to local SQLite tables:
 * - daily_logs: group-level data (wellbeing, sleep, nutrition, notes)
 * - daily_log_events: individual clinical events (symptoms, vitals, pain, etc.)
 *
 * All queries are scoped to the authenticated patient via patient_id.
 */

import { getDatabase } from '@/db/connection';
import type {
  DailyCheckInRequest,
  DailyCheckInDetail,
} from '@/types';

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
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

  await db.withTransactionAsync(async () => {
    // Upsert the daily_logs row
    await db.runAsync(
      `INSERT INTO daily_logs (
        group_id, patient_id, log_date,
        overall_wellbeing, energy_level, stress_level,
        sleep_duration_minutes, sleep_quality, sleep_awakenings,
        water_ml, meals_count, appetite_level,
        notes, created_at, updated_at,
        local_id, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_create')
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

    // Add sync_queue entries
    await addToSyncQueue(db, 'daily_logs', groupId, existing ? 'update' : 'create', {
      group_id: groupId,
      patient_id: patientId,
      log_date: request.log_date,
    });

    for (const event of events) {
      await addToSyncQueue(db, 'daily_log_events', event.event_id, 'create', {
        event_id: event.event_id,
        group_id: groupId,
        event_type: event.event_type,
      });
    }
  });

  return groupId;
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

  await db.runAsync(
    `INSERT INTO daily_log_events (
      event_id, group_id, event_type, concept_id,
      event_time, payload_json, created_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_create')`,
    [localId, groupId, eventType, conceptId, eventTime, JSON.stringify(payload), now],
  );

  await addToSyncQueue(db, 'daily_log_events', localId, 'create', {
    event_id: localId,
    group_id: groupId,
    event_type: eventType,
  });

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

  await db.runAsync(
    `UPDATE daily_log_events
     SET payload_json = ?, sync_status = 'pending_update'
     WHERE event_id = ?`,
    [JSON.stringify(payload), eventId],
  );

  await addToSyncQueue(db, 'daily_log_events', eventId, 'update', {
    event_id: eventId,
    group_id: event.group_id,
  });
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
    // Synced — soft delete via sync_queue
    await db.runAsync(
      "UPDATE daily_log_events SET sync_status = 'pending_delete' WHERE event_id = ?",
      [eventId],
    );
    await addToSyncQueue(db, 'daily_log_events', eventId, 'delete', null);
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

  await db.withTransactionAsync(async () => {
    // Upsert the daily_logs row
    await db.runAsync(
      `INSERT INTO daily_logs (
        group_id, patient_id, log_date,
        overall_wellbeing, energy_level, stress_level,
        sleep_duration_minutes, sleep_quality, sleep_awakenings,
        water_ml, meals_count, appetite_level,
        notes, created_at, updated_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
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
      },
    });
  }

  // Nutrition
  if (detail.water_ml != null || detail.meals_count != null || detail.appetite_level != null) {
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
  let water_ml: number | null = null;
  let meals_count: number | null = null;
  let appetite_level: number | null = null;
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
        break;

      case 'ACTIVITY_LOG':
        activities.push({
          activity_type: payload.activity_type as string,
          duration_minutes: payload.duration_minutes as number ?? null,
          calories_burned: payload.calories_burned as number ?? null,
        });
        break;

      case 'NUTRITION_LOG':
        water_ml = payload.water_ml as number ?? null;
        meals_count = payload.meals_count as number ?? null;
        appetite_level = payload.appetite_level as number ?? null;
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

  return {
    group_id: log.group_id,
    log_date: log.log_date,
    overall_wellbeing: log.overall_wellbeing,
    energy_level: log.energy_level,
    stress_level: log.stress_level,
    sleep_duration_minutes,
    sleep_quality,
    sleep_awakenings,
    water_ml,
    meals_count,
    appetite_level,
    symptoms,
    vitals,
    pain,
    activities,
    medications,
    notes,
  };
}

// ─── Sync Queue ──────────────────────────────────────────────────────────────

async function addToSyncQueue(
  db: Awaited<ReturnType<typeof getDatabase>>,
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
      await db.runAsync(
        "UPDATE sync_queue SET operation = ?, payload_json = ?, created_at = datetime('now') WHERE id = ?",
        [operation, payload ? JSON.stringify(payload) : null, existing.id],
      );
    } else {
      await db.runAsync(
        'INSERT INTO sync_queue (table_name, record_id, mutation_id, operation, payload_json) VALUES (?, ?, ?, ?, ?)',
        [tableName, recordId, mutationId, operation, payload ? JSON.stringify(payload) : null],
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
