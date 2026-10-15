/**
 * importWiring.ts — binds the pure import pipeline to real app services.
 *
 * The only module allowed to touch the database layer, the native adapter,
 * and the refresh bus for Health Connect. Everything underneath stays
 * injected and unit-tested; this file is covered by tsc + the app itself.
 */

import { getDailyLogDetail, insertDailyLogEvent, mergeIntoDailyLog } from '@/db/queries/dailyLogs';
import { upsertLocalStepDay } from '@/db/queries/stepCounts';
import { requestDataRefresh } from '@/services/dataRefresh';
import { api } from '@/services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { grantConsent, readConsent, revokeConsent } from './consent';
import { resolveWeightConceptId } from './conceptResolver';
import { asyncConsentStorage } from './consentStore';
import {
  nativeAvailabilityReason,
  nativeImportAdapter,
  openHealthConnectSettings,
} from './nativeAdapter';
import { runHealthConnectImport, type ImportReport } from './importer';

export type ConnectionStatus = 'unavailable' | 'off' | 'on';

export async function connectionStatus(): Promise<{ status: ConnectionStatus; reason: string }> {
  if (nativeAvailabilityReason() !== 'ready') {
    return { status: 'unavailable', reason: nativeAvailabilityReason() };
  }
  const record = await readConsent(asyncConsentStorage).catch(() => null);
  if (record?.granted === true) return { status: 'on', reason: 'connected' };
  return { status: 'off', reason: 'not-connected' };
}

/** One manual or scheduled sync pass. Returns the import report. */
export async function runHealthConnectSync(patientId: string): Promise<ImportReport> {
  return runHealthConnectImport({
    storage: asyncConsentStorage,
    adapter: nativeImportAdapter,
    store: {
      getDetail: (logDate: string) => getDailyLogDetail(patientId, logDate),
      mergeDay: (logDate: string, overlay: { sleep_minutes?: number }) =>
        mergeIntoDailyLog(patientId, logDate, overlay),
      insertActivity: async (
        groupId: string,
        eventTime: string,
        activity: { activity_type: string; duration_minutes: number; calories_burned: number | null; distance_km: number | null },
      ) => {
        await insertDailyLogEvent(patientId, groupId, 'ACTIVITY_LOG', null, eventTime, {
          activity_type: activity.activity_type,
          duration_minutes: activity.duration_minutes,
          calories_burned: activity.calories_burned,
          ...(activity.distance_km !== null ? { distance_km: activity.distance_km } : {}),
        });
      },
      resolveWeightConcept: async () =>
        resolveWeightConceptId(async () =>
          api.get('/api/v1/ontology/manual-log-concepts'),
        ).catch(() => null),
      saveSteps: (logDate: string, steps: number) => upsertLocalStepDay(patientId, logDate, steps),
      refresh: () => requestDataRefresh(),
      nowISO: () => new Date().toISOString(),
    },
  });
}

export async function disconnectHealthConnect(): Promise<void> {
  // Our own disconnected state stops all future imports immediately (Google's
  // recommended pattern — revokeAllPermissions needs an app restart to bite).
  await revokeConsent(asyncConsentStorage);
}

export function openAccessManagement(): boolean {
  return openHealthConnectSettings();
}

const LAST_IMPORT_KEY = 'hg:hc-last-import:v1';

export interface LastImportSummary {
  at: string;
  sleepImported: number;
  activitiesImported: number;
}

export async function readLastImport(): Promise<LastImportSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_IMPORT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<LastImportSummary>;
    if (typeof parsed.at !== 'string' || typeof parsed.sleepImported !== 'number') return null;
    return {
      at: parsed.at,
      sleepImported: parsed.sleepImported,
      activitiesImported: typeof parsed.activitiesImported === 'number' ? parsed.activitiesImported : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Full connect flow: availability → explicit consent → Health Connect
 * permission → first import. Consent is revoked again if the system
 * permission is denied, keeping the stored state honest.
 */
export async function connectHealthConnect(
  patientId: string,
): Promise<{ connected: boolean; report: ImportReport | null; reason: string }> {
  if (nativeAvailabilityReason() !== 'ready') {
    return { connected: false, report: null, reason: nativeAvailabilityReason() };
  }
  await grantConsent(asyncConsentStorage, ['sleep', 'exercise']);
  if (!(await nativeImportAdapter.ensurePermissions())) {
    await revokeConsent(asyncConsentStorage);
    return { connected: false, report: null, reason: 'permission-denied' };
  }
  const report = await runHealthConnectSync(patientId);
  if (report.status === 'ok') {
    await AsyncStorage.setItem(
      LAST_IMPORT_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        sleepImported: report.sleepImported,
        activitiesImported: report.activitiesImported,
      }),
    ).catch(() => {});
  }
  return { connected: report.status === 'ok', report, reason: report.reason ?? 'connected' };
}
