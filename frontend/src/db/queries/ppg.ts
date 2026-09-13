/**
 * ppg.ts — Local SQLite repository for on-device camera-PPG measurements.
 *
 * Stores ONLY compact derived scalars (HR, HRV, quality). Raw frames, video,
 * and raw PPG streams never touch this table. Raw stays on-device unless the
 * user explicitly opts into export for research/diagnostics.
 */

import { getDatabase } from '@/db/connection';

export interface LocalPpgMeasurement {
  measurement_id: string;
  patient_id: string;
  measured_at: string;
  heart_rate_bpm: number | null;
  signal_quality: number;
  duration_seconds: number;
  rmssd_ms: number | null;
  sdnn_ms: number | null;
  rr_intervals_json: string | null;
  algorithm_version: string;
  reliable: number;
  sync_status: string;
}

export interface PpgDerivedInput {
  heartRateBpm: number | null;
  signalQuality: number;
  durationSeconds: number;
  rmssdMs?: number | null;
  sdnnMs?: number | null;
  rrIntervalsMs?: number[];
  algorithmVersion: string;
  measuredAt: string;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function insertPpgMeasurement(
  patientId: string,
  input: PpgDerivedInput,
): Promise<string> {
  const db = await getDatabase();
  const id = randomId();
  const reliable =
    input.heartRateBpm != null &&
    input.signalQuality >= 0.5 &&
    input.durationSeconds >= 30
      ? 1
      : 0;
  await db.runAsync(
    `INSERT INTO ppg_measurements
      (measurement_id, patient_id, measured_at, heart_rate_bpm, signal_quality,
       duration_seconds, rmssd_ms, sdnn_ms, rr_intervals_json, algorithm_version,
       reliable, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    patientId,
    input.measuredAt,
    input.heartRateBpm,
    input.signalQuality,
    input.durationSeconds,
    input.rmssdMs ?? null,
    input.sdnnMs ?? null,
    input.rrIntervalsMs ? JSON.stringify(input.rrIntervalsMs) : null,
    input.algorithmVersion,
    reliable,
  );
  return id;
}

export async function getPendingPpgMeasurements(
  patientId: string,
): Promise<LocalPpgMeasurement[]> {
  const db = await getDatabase();
  return db.getAllAsync<LocalPpgMeasurement>(
    `SELECT * FROM ppg_measurements
     WHERE patient_id = ? AND sync_status = 'pending'
     ORDER BY measured_at ASC`,
    patientId,
  );
}

export async function markPpgSynced(measurementId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE ppg_measurements SET sync_status = 'synced' WHERE measurement_id = ?`,
    measurementId,
  );
}

export async function getRecentPpgMeasurements(
  patientId: string,
  limit = 20,
): Promise<LocalPpgMeasurement[]> {
  const db = await getDatabase();
  return db.getAllAsync<LocalPpgMeasurement>(
    `SELECT * FROM ppg_measurements
     WHERE patient_id = ?
     ORDER BY measured_at DESC LIMIT ?`,
    patientId,
    limit,
  );
}
