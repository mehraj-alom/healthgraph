/**
 * ppgService — offline-first sync for camera-PPG derived measurements.
 *
 * Flow: measure on-device -> save locally (works offline) -> sync derived
 * payload only (POST /api/v1/ppg/measurements) when online.
 *
 * NEVER uploads: camera frames, video, raw PPG streams. The `rawSignal`
 * field from an opt-in export is deliberately dropped before any network
 * call — export/sharing is a separate explicit user action, not sync.
 */

import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getPendingPpgMeasurements,
  insertPpgMeasurement,
  markPpgSynced,
  type LocalPpgMeasurement,
  type PpgDerivedInput,
} from '@/db/queries/ppg';

export interface PpgSyncResult {
  savedLocalId: string;
  syncedToServer: boolean;
}

/** Persist a derived result locally, then best-effort sync the derived payload. */
export async function saveAndSyncPpgResult(
  input: PpgDerivedInput & { simulated?: boolean },
): Promise<PpgSyncResult> {
  if (input.simulated === true) {
    // Defense in depth: simulated results must never reach storage or sync,
    // even if a caller miswires the provider boundary.
    throw new Error('Simulated PPG results cannot be saved or synced.');
  }
  const patientId = getCachedPatientId();
  if (!patientId) throw new Error('Your session has expired. Please sign in again.');

  const savedLocalId = await insertPpgMeasurement(patientId, input);

  let syncedToServer = false;
  try {
    await api.post('/api/v1/ppg/measurements', {
      measurementType: 'camera_ppg',
      measuredAt: input.measuredAt,
      heartRateBpm: input.heartRateBpm,
      signalQuality: input.signalQuality,
      durationSeconds: input.durationSeconds,
      rmssdMs: input.rmssdMs ?? null,
      sdnnMs: input.sdnnMs ?? null,
      rrIntervalsMs: input.rrIntervalsMs ?? null,
      algorithmVersion: input.algorithmVersion,
      // NOTE: no rawSignal, no frames, no video — derived only, by design.
    });
    await markPpgSynced(savedLocalId);
    syncedToServer = true;
  } catch {
    // Offline or server error — stays 'pending', retried by syncPendingPpg().
  }
  return { savedLocalId, syncedToServer };
}

/** Retry pending uploads (derived payloads only). Safe to call on reconnect. */
export async function syncPendingPpg(): Promise<{ synced: number; remaining: number }> {
  const patientId = getCachedPatientId();
  if (!patientId) return { synced: 0, remaining: 0 };
  const pending: LocalPpgMeasurement[] = await getPendingPpgMeasurements(patientId);
  let synced = 0;
  for (const row of pending) {
    try {
      await api.post('/api/v1/ppg/measurements', {
        measurementType: 'camera_ppg',
        measuredAt: row.measured_at,
        heartRateBpm: row.heart_rate_bpm,
        signalQuality: row.signal_quality,
        durationSeconds: row.duration_seconds,
        rmssdMs: row.rmssd_ms,
        sdnnMs: row.sdnn_ms,
        rrIntervalsMs: row.rr_intervals_json ? JSON.parse(row.rr_intervals_json) : null,
        algorithmVersion: row.algorithm_version,
      });
      await markPpgSynced(row.measurement_id);
      synced += 1;
    } catch {
      break; // stop on first failure; retry next time (offline-first)
    }
  }
  return { synced, remaining: pending.length - synced };
}
