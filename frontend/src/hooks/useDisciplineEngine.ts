/**
 * useDisciplineEngine — Discipline Engine data hook (Batch 6D).
 *
 * Five bounded, patient-scoped reads (daily logs, dose events in a
 * trailing-14-day instant range, substance + cycle entries, recent heart
 * rows) projected through the pure disciplineEngine.ts contract. Refreshes
 * on focus and on dataRefresh; logged-out yields empty (the screen shows
 * the honest empty state). No polling, no N+1 (one range query replaces
 * per-day reads), no writes, no blended metrics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getDailyLogs } from '@/db/queries/dailyLogs';
import { getTakenEventsInRange } from '@/db/queries/medicationTakenEvents';
import { listSubstanceEntries } from '@/db/queries/substances';
import { listCycleEntries } from '@/db/queries/cycle';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  DISCIPLINE_HISTORY_DAYS,
  adherenceFromStatuses,
  collectActiveDates,
  countPriorWeek,
  countTrailingWeek,
  currentActiveStreak,
  describeActiveDaysChange,
  trailingRangeIso,
  isInTrailingWeek,
  type AdherenceResult,
} from '@/screens/DisciplineEngine/disciplineEngine';

export interface DisciplineModel {
  today: string;
  /** Union of active calendar days (trailing window). */
  activeDates: string[];
  activeDays7: number;
  priorDays7: number;
  changeLine: string;
  streakDays: number;
  /** Medication adherence; null when no ratable doses exist. */
  adherence: AdherenceResult | null;
  /** Doses seen in the window (any status, provenance for the line). */
  doseEvents: number;
  /** Check-in days in the trailing week. */
  loggedDays7: number;
  hasAnyActivity: boolean;
}

const EMPTY_MODEL: DisciplineModel = {
  today: '',
  activeDates: [],
  activeDays7: 0,
  priorDays7: 0,
  changeLine: '',
  streakDays: 0,
  adherence: null,
  doseEvents: 0,
  loggedDays7: 0,
  hasAnyActivity: false,
};

export function useDisciplineEngine(): {
  model: DisciplineModel;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [model, setModel] = useState<DisciplineModel>(EMPTY_MODEL);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setModel(EMPTY_MODEL);
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
      const now = todayKey();
      const [rangeStart, rangeEnd] = trailingRangeIso(now, DISCIPLINE_HISTORY_DAYS);
      const [logs, taken, substance, cycle, heart] = await Promise.all([
        getDailyLogs(patientId, 30).catch(() => []),
        getTakenEventsInRange(patientId, rangeStart, rangeEnd).catch(() => []),
        listSubstanceEntries(patientId, 200).catch(() => []),
        listCycleEntries(patientId, 200).catch(() => []),
        getRecentLocalHeartRates(patientId, 60).catch(() => []),
      ]);
      if (!mounted.current) return;
      const active = collectActiveDates({
        logDates: logs.map((l) => l.log_date),
        takenInstants: taken.map((e) => e.taken_at),
        substanceDates: substance.map((e) => String(e.occurred_at).slice(0, 10)),
        cycleDates: cycle.map((e) => e.date),
        heartDates: heart.map((r) => r.measuredAt),
      });
      const activeDays7 = countTrailingWeek(active, now);
      const priorDays7 = countPriorWeek(active, now);
      const loggedDays7 = logs.filter((l) =>
        isInTrailingWeek(l.log_date.slice(0, 10), now),
      ).length;
      setModel({
        today: now,
        activeDates: [...active].sort(),
        activeDays7,
        priorDays7,
        changeLine: describeActiveDaysChange(activeDays7, priorDays7),
        streakDays: currentActiveStreak(active, now),
        adherence: adherenceFromStatuses(taken.map((e) => e.status)),
        doseEvents: taken.length,
        loggedDays7,
        hasAnyActivity: active.size > 0,
      });
      setIsLoading(false);
    } catch {
      if (mounted.current) setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    void load();
    const unsub = subscribeDataRefresh(() => {
      if (mounted.current) {
        setIsLoading(true);
        void load();
      }
    });
    return () => {
      mounted.current = false;
      unsub();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void load();
    }, [load]),
  );

  return { model, isLoading, refetch: load };
}
