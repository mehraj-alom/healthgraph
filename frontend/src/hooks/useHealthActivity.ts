/**
 * useHealthActivity — unified on-device activity stream.
 *
 * Composes the patient-scoped local sources the app already stores
 * (daily logs, taken doses, camera heart readings, substance + cycle
 * entries, documents) into one chronological projection. Server timeline
 * rows are intentionally excluded (the Timeline screen owns those) — this
 * is the local-first complement that renders instantly, offline, and
 * includes device-only rows the server can never return.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getDailyLogs } from '@/db/queries/dailyLogs';
import { getMedicationTakenEventsForDate } from '@/db/queries/medicationTakenEvents';
import { getMedications } from '@/db/queries/medications';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { getPendingPpgMeasurements } from '@/db/queries/ppg';
import { getPendingRppgMeasurements } from '@/db/queries/rppg';
import { listSubstanceEntries } from '@/db/queries/substances';
import { listCycleEntries } from '@/db/queries/cycle';
import { getDocuments } from '@/db/queries/documents';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { buildActivityItems, type ActivityItem } from '@/screens/HealthAreas/activity';

export type { ActivityItem };

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useHealthActivity(limitDays = 14): {
  items: ActivityItem[];
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setItems([]);
          setIsLoading(false);
        }
        return;
      }
      await waitForIdentityReady().catch(() => {});
      const patientId = getCachedPatientId();
      if (!patientId || !mounted.current) {
        if (mounted.current) setIsLoading(false);
        return;
      }
      const today = todayKey();
      const dayKeys = Array.from({ length: limitDays }, (_, i) => shiftDayKey(today, -i));
      const [logs, meds, heart, pendingPpg, pendingRppg, substance, cycle, docs] =
        await Promise.all([
          getDailyLogs(patientId, limitDays).catch(() => []),
          getMedications(patientId).catch(() => []),
          getRecentLocalHeartRates(patientId, 60).catch(() => []),
          getPendingPpgMeasurements(patientId).catch(() => []),
          getPendingRppgMeasurements(patientId).catch(() => []),
          listSubstanceEntries(patientId, 100).catch(() => []),
          listCycleEntries(patientId, 100).catch(() => []),
          getDocuments(patientId, { limit: 30 }).catch(() => []),
        ]);
      const takenNested = await Promise.all(
        dayKeys.map((date) =>
          getMedicationTakenEventsForDate(patientId, date).catch(() => []),
        ),
      );
      if (!mounted.current) return;
      const medNames = new Map(meds.map((m) => [m.medication_id, m.name]));
      const pendingIds = new Set([
        ...pendingPpg.map((r) => r.measurement_id),
        ...pendingRppg.map((r) => r.measurement_id),
      ]);
      // Taken rows carry no sync_status through the mapped type: a 'local-'
      // id means never reconciled with the server (still pending), anything
      // else came back from (or through) the server.
      const takenWithSync = takenNested.flat().map((t) => ({
        ...t,
        medication_name: medNames.get(t.medication_id) ?? null,
        sync_status: t.event_id.startsWith('local-') ? 'pending_create' : 'synced',
      }));
      setItems(
        buildActivityItems({
          patientId,
          logs,
          taken: takenWithSync,
          heart: hrRowsToInput(heart, pendingIds),
          substance,
          cycle,
          documents: docs,
        }),
      );
      setIsLoading(false);
    } catch {
      if (mounted.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, limitDays]);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    void load();
    const unsubscribe = subscribeDataRefresh(() => {
      void load();
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  return { items, isLoading, refetch };
}

function hrRowsToInput(
  rows: Awaited<ReturnType<typeof getRecentLocalHeartRates>>,
  pendingIds: Set<string>,
): Array<{
  measurementId: string;
  method: 'ppg' | 'rppg';
  bpm: number;
  measuredAt: string;
  pending: boolean;
}> {
  // getRecentLocalHeartRates returns the unified feed; the method travels
  // on each row (see heartRate.ts LocalHeartRatePoint).
  return (rows as Array<{
    measurementId: string;
    method: 'ppg' | 'rppg';
    bpm: number;
    measuredAt: string;
  }>).map((r) => ({
    measurementId: r.measurementId,
    method: r.method,
    bpm: r.bpm,
    measuredAt: r.measuredAt,
    pending: pendingIds.has(r.measurementId),
  }));
}
