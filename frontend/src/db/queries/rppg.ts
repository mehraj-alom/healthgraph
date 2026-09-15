/**
 * rppg.ts — Local SQLite repository for on-device face-rPPG measurements.
 *
 * Separate table from ppg_measurements by design: fingertip PPG and face
 * rPPG are distinct modalities. Stores ONLY compact derived scalars (HR,
 * quality, model/version provenance). Raw frames, video, and face data
 * never touch this table. HRV is unavailable for the 160-frame window and
 * is therefore never stored here (fields stay null/absent, never invented).
 */

import { getDatabase } from '@/db/connection';
import { rppgReliableForPersistence } from '@/services/rppg/qualityGate';

export interface LocalRppgMeasurement {
  measurement_id: string;
  patient_id: string;
  measured_at: string;
  heart_rate_bpm: number | null;
  signal_quality: number;
  duration_seconds: number;
  algorithm_version: string;
  model_version: string;
  measurement_type: string;
  sampling_rate_hz: number | null;
  face_stability: number | null;
  reliable: number;
  sync_status: string;
}

export interface RppgDerivedInput {
  heartRateBpm: number | null;
  signalQuality: number;
  durationSeconds: number;
  /** Pipeline version, e.g. 'rppg-1.0.0'. */
  algorithmVersion: string;
  /** Model identity, e.g. 'physformer-rppg-1.0.0'. */
  modelVersion: string;
  samplingRateHz?: number | null;
  faceStability?: number | null;
  measuredAt: string;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * rPPG reliability: an actual heart rate, adequate composite quality, and a
 * complete capture window (≈5s at 30fps — NOT the 30s fingertip threshold).
 */
export function isRppgReliable(input: {
  heartRateBpm: number | null;
  signalQuality: number;
  durationSeconds: number;
}): boolean {
  return rppgReliableForPersistence(
    input.heartRateBpm,
    input.signalQuality,
    input.durationSeconds,
  );
}

export async function insertRppgMeasurement(
  patientId: string,
  input: RppgDerivedInput,
): Promise<string> {
  const db = await getDatabase();
  const id = randomId();
  const reliable = isRppgReliable(input) ? 1 : 0;
  await db.runAsync(
    `INSERT INTO rppg_measurements
      (measurement_id, patient_id, measured_at, heart_rate_bpm, signal_quality,
       duration_seconds, algorithm_version, model_version, measurement_type,
       sampling_rate_hz, face_stability, reliable, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'face_rppg', ?, ?, ?, 'pending')`,
    id,
    patientId,
    input.measuredAt,
    input.heartRateBpm,
    input.signalQuality,
    input.durationSeconds,
    input.algorithmVersion,
    input.modelVersion,
    input.samplingRateHz ?? null,
    input.faceStability ?? null,
    reliable,
  );
  return id;
}

export async function getPendingRppgMeasurements(
  patientId: string,
): Promise<LocalRppgMeasurement[]> {
  const db = await getDatabase();
  return db.getAllAsync<LocalRppgMeasurement>(
    `SELECT * FROM rppg_measurements
     WHERE patient_id = ? AND sync_status = 'pending'
     ORDER BY measured_at ASC`,
    patientId,
  );
}

export async function markRppgSynced(measurementId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE rppg_measurements SET sync_status = 'synced' WHERE measurement_id = ?`,
    measurementId,
  );
}

export async function getRecentRppgMeasurements(
  patientId: string,
  limit = 20,
): Promise<LocalRppgMeasurement[]> {
  const db = await getDatabase();
  return db.getAllAsync<LocalRppgMeasurement>(
    `SELECT * FROM rppg_measurements
     WHERE patient_id = ?
     ORDER BY measured_at DESC LIMIT ?`,
    patientId,
    limit,
  );
}
