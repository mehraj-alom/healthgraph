/**
 * rppgService — offline-first sync for face-rPPG derived measurements.
 *
 * Flow: capture + infer on-device -> save locally (works offline) -> sync
 * derived payload only (POST /api/v1/ppg/measurements) when online.
 *
 * NEVER uploads: camera frames, face frames, video, window files, tensors.
 * Only compact derived scalars cross the network, mirroring the fingertip
 * PPG privacy contract. HRV is unavailable for the short rPPG window and
 * is sent as null — never invented.
 */

import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getPendingRppgMeasurements,
  insertRppgMeasurement,
  markRppgSynced,
  type LocalRppgMeasurement,
  type RppgDerivedInput,
} from '@/db/queries/rppg';

export interface RppgSyncResult {
  savedLocalId: string;
  syncedToServer: boolean;
}

/** Persist a derived result locally, then best-effort sync the derived payload. */
export async function saveAndSyncRppgResult(
  input: RppgDerivedInput,
): Promise<RppgSyncResult> {
  const patientId = getCachedPatientId();
  if (!patientId) throw new Error('Your session has expired. Please sign in again.');

  const savedLocalId = await insertRppgMeasurement(patientId, input);

  let syncedToServer = false;
  try {
    await api.post('/api/v1/ppg/measurements', {
      measurementType: 'face_rppg',
      measuredAt: input.measuredAt,
      heartRateBpm: input.heartRateBpm,
      signalQuality: input.signalQuality,
      durationSeconds: input.durationSeconds,
      rmssdMs: null,
      sdnnMs: null,
      rrIntervalsMs: null,
      algorithmVersion: input.algorithmVersion,
      modelVersion: input.modelVersion,
      samplingRateHz: input.samplingRateHz ?? null,
      // NOTE: no frames, no video, no window bytes, no tensors — derived only.
    });
    await markRppgSynced(savedLocalId);
    syncedToServer = true;
  } catch {
    // Offline or server error — stays 'pending', retried by syncPendingRppg().
  }
  return { savedLocalId, syncedToServer };
}

/** Retry pending uploads (derived payloads only). Safe to call on reconnect. */
export async function syncPendingRppg(): Promise<{ synced: number; remaining: number }> {
  const patientId = getCachedPatientId();
  if (!patientId) return { synced: 0, remaining: 0 };
  const pending: LocalRppgMeasurement[] = await getPendingRppgMeasurements(patientId);
  let synced = 0;
  for (const row of pending) {
    try {
      await api.post('/api/v1/ppg/measurements', {
        measurementType: 'face_rppg',
        measuredAt: row.measured_at,
        heartRateBpm: row.heart_rate_bpm,
        signalQuality: row.signal_quality,
        durationSeconds: row.duration_seconds,
        rmssdMs: null,
        sdnnMs: null,
        rrIntervalsMs: null,
        algorithmVersion: row.algorithm_version,
        modelVersion: row.model_version,
        samplingRateHz: row.sampling_rate_hz,
      });
      await markRppgSynced(row.measurement_id);
      synced += 1;
    } catch {
      break; // stop on first failure; retry next time (offline-first)
    }
  }
  return { synced, remaining: pending.length - synced };
}
