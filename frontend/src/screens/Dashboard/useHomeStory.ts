/**
 * useHomeStory — local-first recent-health-events and daily detail loader.
 *
 * Reads ONLY from the existing SQLite query modules; no new tables, no new
 * network endpoints. On cold start the hydration hooks (medications, metrics)
 * fire their own server calls in the background. This hook reads what
 * SQLite already has (offline-first).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import {
  getDailyLogs as dbGetDailyLogs,
  getDailyLogEvents as dbGetDailyLogEvents,
  getDailyLogDetail as dbGetDailyLogDetail,
  hydrateDailyLog as dbHydrateDailyLog,
} from '@/db/queries/dailyLogs';
import { api } from '@/services/api';
import { getMedications as dbGetMedications } from '@/db/queries/medications';
import { getMedicationTakenEventsForDate as dbGetTakenEventsForDate } from '@/db/queries/medicationTakenEvents';
import { getDocuments as dbGetDocuments } from '@/db/queries/documents';
import {
  localDateString,
  storyItemFromLogEvent,
  type HomeStoryItem,
  type MedicationSummary,
  buildMedicationSummary,
} from './homeData';
import type { Medication, MedicationTakenEvent, DailyCheckInDetail } from '@/types';

interface UseHomeStoryResult {
  /** Recent health events across last 7 days, time-sorted descending. */
  story: HomeStoryItem[];
  /** Today's water intake in ml (from today's daily log detail). */
  water: number | null;
  /** Today's detailed daily-log (wellbeing, sleep, vitals present today). */
  todayDetail: DailyCheckInDetail | null;
  /** Today's taken medication events (for "X of Y doses" logic). */
  takenToday: MedicationTakenEvent[];
  /** Medication summary computed from active meds + today's taken events. */
  medSummary: MedicationSummary | null;
  /** Data still loading on first mount. */
  isLoading: boolean;
  /** Pull-to-refresh or focus refetch. */
  refetch: () => Promise<void>;
}

export function useHomeStory(): UseHomeStoryResult {
  const { user } = useAuth();
  const patientId = getCachedPatientId();
  const [story, setStory] = useState<HomeStoryItem[]>([]);
  const [water, setWater] = useState<number | null>(null);
  const [todayDetail, setTodayDetail] = useState<DailyCheckInDetail | null>(null);
  const [takenToday, setTakenToday] = useState<MedicationTakenEvent[]>([]);
  const [medSummary, setMedSummary] = useState<MedicationSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const runningRef = useRef(0);

  const load = useCallback(async () => {
    if (!user || !patientId) {
      setIsLoading(false);
      return;
    }
    const run = ++runningRef.current;
    const today = localDateString();
    try {
      // ── Today's detail (water, wellbeing summary, sleep summary) ──
      // Local-first; after an app-data wipe/reinstall the local row is gone
      // while the server still holds today's check-in, so fall back to one
      // server fetch and hydrate SQLite (same pattern as VitalsLogger).
      // Local pending edits always win: hydrate skips non-synced rows.
      let detail = await dbGetDailyLogDetail(patientId, today).catch(() => null);
      if (!detail) {
        try {
          const serverDetail = await api.get<DailyCheckInDetail>(
            `/api/v1/logs/daily-checkin/${today}`,
          );
          await dbHydrateDailyLog(patientId, serverDetail).catch(() => {});
          detail =
            (await dbGetDailyLogDetail(patientId, today).catch(() => null)) ??
            serverDetail;
          if (__DEV__) console.log(`[HomeStory] today recovered from server date=${today}`);
        } catch (e: any) {
          // 404 (nothing logged today) or offline — detail stays null.
          // Status only (never bodies): tells wipe-recovery apart from
          // no-log and no-network when reading dev logs.
          if (__DEV__) {
            const status = e?.response?.status ?? 'none';
            console.log(`[HomeStory] today server fallback missed date=${today} status=${status}`);
          }
        }
      }

      // ── Active medications (local DB, non-blocking) ──
      const meds = await dbGetMedications(patientId).catch(() => [] as Medication[]);

      // ── Today's medication taken events ──
      const taken = await dbGetTakenEventsForDate(patientId, today).catch(
        () => [] as MedicationTakenEvent[],
      );

      const medSummary = buildMedicationSummary(
        meds,
        taken,
        // Doses reported via today's daily check-in count too (deduped by
        // name inside the summary so one dose never counts twice).
        (detail?.medications ?? []).map((m) => m.medication_name),
      );

      // ── Build medication name lookup for concept_id fallback ──
      const medName = new Map<string, string>();
      for (const m of meds) {
        medName.set(m.medication_id, m.name);
      }

      // ── Merge: daily-log events + medication taken + documents ──
      const items: HomeStoryItem[] = [];

      const logs = await dbGetDailyLogs(patientId, 7).catch(() => []);
      for (const log of logs) {
        const events = await dbGetDailyLogEvents(patientId, log.group_id).catch(() => []);
        for (const ev of events) {
          const item = storyItemFromLogEvent(
            // Map to local structural type for homeData
            {
              event_id: ev.event_id,
              group_id: ev.group_id,
              event_type: ev.event_type,
              concept_id: ev.concept_id,
              event_time: ev.event_time,
              payload_json: ev.payload_json,
              created_at: ev.created_at,
            },
            medName,
          );
          if (item) items.push(item);
        }
      }

      for (const ev of taken) {
        items.push({
          id: ev.event_id,
          time: ev.taken_at,
          dayKey: localDateString(new Date(ev.taken_at)),
          category: 'medication',
          title: 'Medication taken',
          detail: medName.get(ev.medication_id) ?? 'Dose taken',
          icon: '💊',
        });
      }

      const docs = await dbGetDocuments(patientId, { limit: 5 }).catch(() => []);
      for (const d of docs) {
        items.push({
          id: d.document_id,
          time: d.created_at,
          dayKey: localDateString(new Date(d.created_at)),
          category: 'document',
          title: 'Document added',
          detail: 'Medical record added',
          icon: '📄',
        });
      }

      items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      if (run === runningRef.current) {
        setWater(detail?.water_ml ?? null);
        setTodayDetail(detail);
        setTakenToday(taken);
        setMedSummary(medSummary);
        setStory(items.slice(0, 30));
      }
    } catch {
      // Keep empty / stale state on failure — the UI gracefully handles it.
    } finally {
      if (run === runningRef.current) setIsLoading(false);
    }
  }, [user, patientId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    await load();
  }, [load]);

  return { story, water, todayDetail, takenToday, medSummary, isLoading, refetch };
}