/**
 * Local-first repository for AnatomicalObservation and BodyStateSnapshot data.
 *
 * Strategy:
 *   - Observations are READ-ONLY from the frontend perspective.
 *   - No creation UI exists — observations are created by the backend
 *     from daily check-in pain entries or other server-side processes.
 *   - Local SQLite caches server observations as synced data.
 *   - Hydration from server overwrites synced data, preserves pending local mutations.
 *
 * Maps to:
 *   - models/anatomy.py AnatomicalObservation
 *   - models/anatomy.py PatientBodyStateSnapshot
 *   - schemas/body_state.py BodyStateItem
 *   - frontend/src/types/index.ts Observation, BodyStateItem
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../connection';
import type { Observation, BodyStateItem } from '@/types';

// ============================================================================
// READ — Observations
// ============================================================================

/**
 * Get all observations for a patient.
 * Returns from local SQLite. Caller should hydrate from server if needed.
 */
export async function getObservations(
  patientId: string,
  options?: { limit?: number; offset?: number; structureId?: string },
): Promise<Observation[]> {
  const db = await getDatabase();

  let query = `
    SELECT
      observation_id,
      structure_id,
      finding_code,
      finding_display_name,
      visual_status,
      visual_severity_score,
      trend,
      clinical_summary
    FROM observations
    WHERE patient_id = ?
  `;
  const params: any[] = [patientId];

  if (options?.structureId) {
    query += ` AND structure_id = ?`;
    params.push(options.structureId);
  }

  query += ` ORDER BY recorded_at DESC`;

  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options?.offset) {
    query += ` OFFSET ?`;
    params.push(options.offset);
  }

  const rows = await db.getAllAsync<{
    observation_id: string;
    structure_id: string;
    finding_code: string;
    finding_display_name: string;
    visual_status: string;
    visual_severity_score: number;
    trend: string;
    clinical_summary: string | null;
  }>(query, params);

  return rows.map(mapRowToObservation);
}

/**
 * Get a single observation by ID.
 */
export async function getObservationById(
  patientId: string,
  observationId: string,
): Promise<Observation | null> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    observation_id: string;
    structure_id: string;
    finding_code: string;
    finding_display_name: string;
    visual_status: string;
    visual_severity_score: number;
    trend: string;
    clinical_summary: string | null;
  }>(
    `
    SELECT
      observation_id,
      structure_id,
      finding_code,
      finding_display_name,
      visual_status,
      visual_severity_score,
      trend,
      clinical_summary
    FROM observations
    WHERE patient_id = ? AND observation_id = ?
    `,
    [patientId, observationId],
  );

  return row ? mapRowToObservation(row) : null;
}

/**
 * Get observations for a specific anatomical structure.
 */
export async function getObservationsForStructure(
  patientId: string,
  structureId: string,
  options?: { limit?: number },
): Promise<Observation[]> {
  return getObservations(patientId, { ...options, structureId });
}

// ============================================================================
// READ — Body State Snapshots
// ============================================================================

/**
 * Get all body state snapshots for a patient.
 * Returns from local SQLite. Caller should hydrate from server if needed.
 */
export async function getBodyStateSnapshots(
  patientId: string,
): Promise<BodyStateItem[]> {
  const db = await getDatabase();

  const rows = await db.getAllAsync<{
    structure_id: string;
    display_name: string;
    mesh_node_name: string;
    visual_status: string;
    severity: number;
    trend: string;
    latest_summary: string | null;
  }>(
    `
    SELECT
      structure_id,
      display_name,
      mesh_node_name,
      visual_status,
      severity,
      trend,
      latest_summary
    FROM body_state_snapshots
    WHERE patient_id = ?
    ORDER BY structure_id ASC
    `,
    [patientId],
  );

  return rows.map(mapRowToBodyStateItem);
}

/**
 * Get body state snapshot for a specific structure.
 */
export async function getBodyStateSnapshotForStructure(
  patientId: string,
  structureId: string,
): Promise<BodyStateItem | null> {
  const db = await getDatabase();

  const row = await db.getFirstAsync<{
    structure_id: string;
    display_name: string;
    mesh_node_name: string;
    visual_status: string;
    severity: number;
    trend: string;
    latest_summary: string | null;
  }>(
    `
    SELECT
      structure_id,
      display_name,
      mesh_node_name,
      visual_status,
      severity,
      trend,
      latest_summary
    FROM body_state_snapshots
    WHERE patient_id = ? AND structure_id = ?
    `,
    [patientId, structureId],
  );

  return row ? mapRowToBodyStateItem(row) : null;
}

// ============================================================================
// HYDRATION — Server → Local
// ============================================================================

/**
 * Hydrate observations from server response.
 *
 * Rules:
 *   - Server observations enter as synced (sync_status = 'synced').
 *   - Existing pending local mutations are never overwritten.
 *   - Repeated hydration is idempotent.
 *   - All observations require patient_id.
 */
export async function hydrateObservations(
  patientId: string,
  serverObservations: Array<{
    observation_id: string;
    structure_id: string;
    observation_type?: string;
    finding_code: string;
    finding_display_name: string;
    visual_status?: string;
    visual_severity_score?: number;
    trend?: string;
    source_type?: string;
    source_id?: string | null;
    event_id?: string | null;
    document_id?: string | null;
    clinical_summary?: string | null;
    recorded_at: string;
    created_at?: string;
  }>,
): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const obs of serverObservations) {
      // Skip if a pending local mutation exists
      const existing = await db.getFirstAsync<{ sync_status: string }>(
        `SELECT sync_status FROM observations
         WHERE patient_id = ? AND observation_id = ?`,
        [patientId, obs.observation_id],
      );

      if (existing && existing.sync_status !== 'synced') {
        // Preserve pending local mutation
        continue;
      }

      // Upsert server observation
      await db.runAsync(
        `
        INSERT INTO observations (
          observation_id, patient_id, structure_id, observation_type,
          finding_code, finding_display_name, visual_status,
          visual_severity_score, trend, source_type, source_id,
          event_id, document_id, clinical_summary, recorded_at,
          created_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
        ON CONFLICT(observation_id) DO UPDATE SET
          patient_id = excluded.patient_id,
          structure_id = excluded.structure_id,
          observation_type = excluded.observation_type,
          finding_code = excluded.finding_code,
          finding_display_name = excluded.finding_display_name,
          visual_status = excluded.visual_status,
          visual_severity_score = excluded.visual_severity_score,
          trend = excluded.trend,
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          event_id = excluded.event_id,
          document_id = excluded.document_id,
          clinical_summary = excluded.clinical_summary,
          recorded_at = excluded.recorded_at,
          created_at = excluded.created_at,
          sync_status = 'synced'
        WHERE sync_status = 'synced'
        `,
        [
          obs.observation_id,
          patientId,
          obs.structure_id,
          obs.observation_type ?? 'SYMPTOM',
          obs.finding_code,
          obs.finding_display_name,
          obs.visual_status ?? 'normal',
          obs.visual_severity_score ?? 0.0,
          obs.trend ?? 'stable',
          obs.source_type ?? 'PATIENT_REPORTED',
          obs.source_id ?? null,
          obs.event_id ?? null,
          obs.document_id ?? null,
          obs.clinical_summary ?? null,
          obs.recorded_at,
          obs.created_at ?? new Date().toISOString(),
        ],
      );
    }
  });
}

/**
 * Hydrate body state snapshots from server response.
 *
 * Rules:
 *   - Server snapshots enter as cached data.
 *   - Always overwrite (snapshots are materialized read model).
 *   - Repeated hydration is idempotent.
 */
export async function hydrateBodyStateSnapshots(
  patientId: string,
  serverSnapshots: Array<{
    structure_id: string;
    display_name: string;
    mesh_node_name: string;
    visual_status: string;
    severity: number;
    trend: string;
    latest_summary?: string | null;
  }>,
): Promise<void> {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const snap of serverSnapshots) {
      await db.runAsync(
        `
        INSERT INTO body_state_snapshots (
          patient_id, structure_id, display_name, mesh_node_name,
          visual_status, severity, trend, latest_summary, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(patient_id, structure_id) DO UPDATE SET
          display_name = excluded.display_name,
          mesh_node_name = excluded.mesh_node_name,
          visual_status = excluded.visual_status,
          severity = excluded.severity,
          trend = excluded.trend,
          latest_summary = excluded.latest_summary,
          cached_at = datetime('now')
        `,
        [
          patientId,
          snap.structure_id,
          snap.display_name,
          snap.mesh_node_name,
          snap.visual_status,
          snap.severity,
          snap.trend,
          snap.latest_summary ?? null,
        ],
      );
    }
  });
}

// ============================================================================
// INTERNAL — Row Mappers
// ============================================================================

function mapRowToObservation(row: {
  observation_id: string;
  structure_id: string;
  finding_code: string;
  finding_display_name: string;
  visual_status: string;
  visual_severity_score: number;
  trend: string;
  clinical_summary: string | null;
}): Observation {
  return {
    observation_id: row.observation_id,
    structure_id: row.structure_id,
    finding_code: row.finding_code,
    finding_display_name: row.finding_display_name,
    visual_status: row.visual_status,
    visual_severity_score: row.visual_severity_score,
    trend: row.trend,
    clinical_summary: row.clinical_summary ?? '',
  };
}

function mapRowToBodyStateItem(row: {
  structure_id: string;
  display_name: string;
  mesh_node_name: string;
  visual_status: string;
  severity: number;
  trend: string;
  latest_summary: string | null;
}): BodyStateItem {
  return {
    structure_id: row.structure_id,
    display_name: row.display_name,
    mesh_node_name: row.mesh_node_name,
    visual_status: row.visual_status,
    severity: row.severity,
    trend: row.trend,
    latest_summary: row.latest_summary,
  };
}
