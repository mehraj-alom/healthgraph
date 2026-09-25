/**
 * deletion.ts — client orchestration for the two deletion operations.
 *
 * Order is deliberate and fail-closed:
 *   1. Server erasure first (needs the live auth token). Offline or server
 *      failure aborts here and NOTHING local is touched — a half-deleted
 *      state (local gone, server copy alive) must never happen silently.
 *   2. Local SQLite wipe for the patient (health tables, caches, queue).
 *   3. In-memory/UI state reset hooks for the caller (React Query clearing
 *      lives in the screen, which owns useQueryClient).
 *
 * A 'partial' server report still proceeds to the local wipe: any report at
 * all implies the authoritative PostgreSQL phase committed (PG failures
 * surface as thrown errors, not reports), and the orchestrator is
 * idempotent, so retrying converges the remaining subsystems.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/services/api';
import { getCachedPatientId } from '@/services/patientIdentity';
import { PROFILE_PHOTO_STORAGE_KEY, PROFILE_PHOTO_DIR } from '@/hooks/useProfilePhoto';
import { validateErasureReport } from '@/services/deletionContract';
import type { LocalEraseCounts } from '@/db/queries/patientErase';

export interface ErasureSubsystem {
  status: string;
  [key: string]: unknown;
}

export interface ErasureReport {
  status: 'completed' | 'partial' | string;
  delete_account: boolean;
  postgres: Record<string, number>;
  dsr_fulfilled: string[];
  neo4j: ErasureSubsystem;
  qdrant: ErasureSubsystem;
  firebase: ErasureSubsystem;
}

export interface DeletionOutcome {
  report: ErasureReport;
  local: LocalEraseCounts;
}

/** Resolve the acting patient or throw a sign-in error (never anonymous). */
function requirePatientId(): string {
  const patientId = getCachedPatientId();
  if (!patientId) throw new Error('Your session has expired. Please sign in again.');
  return patientId;
}

async function wipeLocal(patientId: string): Promise<LocalEraseCounts> {
  const { deletePatientLocalData } = await import('@/db/queries/patientErase');
  // Cancel this patient's OS reminders first: no stale reminder may
  // survive the wipe (the instances table itself is wiped below).
  const { cancelAllPatientReminders } = await import('@/services/medicationReminders');
  await cancelAllPatientReminders(patientId).catch(() => {});
  const local = await deletePatientLocalData(patientId);
  const { refreshSyncState } = await import('@/services/syncState');
  await refreshSyncState().catch(() => {});
  const { requestDataRefresh } = await import('@/services/dataRefresh');
  requestDataRefresh();
  return local;
}

/**
 * Delete ALL health records (account remains). Returns the server report
 * plus local wipe counts; throws on transport/server failure with nothing
 * wiped.
 */
export async function deleteAllHealthData(): Promise<DeletionOutcome> {
  const patientId = requirePatientId();
  const raw = await api.delete<ErasureReport>('/api/v1/privacy/data');
  // Validate BEFORE touching local state: a garbage/empty body must never
  // trigger the wipe or a success claim. Throws on anything unexpected.
  const status = validateErasureReport(raw);
  const local = await wipeLocal(patientId);
  return { report: { ...(raw as ErasureReport), status }, local };
}

/**
 * Delete the account: health records + profile + server-side identity.
 * The caller must sign out afterwards (the token dies with the Firebase
 * user). Also removes the local-only profile photo.
 */
export async function deleteAccountCompletely(): Promise<DeletionOutcome> {
  const patientId = requirePatientId();
  const raw = await api.delete<ErasureReport>('/api/v1/privacy/account');
  const status = validateErasureReport(raw);
  const local = await wipeLocal(patientId);
  try {
    await AsyncStorage.removeItem(PROFILE_PHOTO_STORAGE_KEY);
  } catch {
    // Non-health UI preference — wipe is best-effort.
  }
  try {
    const FileSystem = await import('expo-file-system/legacy');
    if (FileSystem.documentDirectory) {
      await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${PROFILE_PHOTO_DIR}`, {
        idempotent: true,
      });
    }
  } catch {
    // Profile photo file removal is best-effort; the key is already gone.
  }
  return { report: { ...(raw as ErasureReport), status }, local };
}
