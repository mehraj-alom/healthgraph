/**
 * useHealthAreas — per-patient health-area states from real local rows.
 *
 * Composes existing query modules only (no new state system): camera heart
 * rows, daily logs, medications, documents, substance + cycle entries, plus
 * the cached server vitals for the heart fallback. Refreshes on focus and
 * on dataRefresh; logged-out means every area reports no-data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { useDailyMetrics } from '@/hooks/useDailyMetrics';
import { detectHeartRate } from '@/screens/Dashboard/homeData';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { getActivityLogs, getDailyLogs } from '@/db/queries/dailyLogs';
import { getMedications } from '@/db/queries/medications';
import { getDocuments } from '@/db/queries/documents';
import { getProfileCache } from '@/db/queries/homeCache';
import { getTakenEventsInRange } from '@/db/queries/medicationTakenEvents';
import {
  collectActiveDates,
  countTrailingWeek,
  trailingRangeIso,
} from '@/screens/DisciplineEngine/disciplineEngine';
import { fitnessWindowStart } from '@/screens/FitnessEngine/fitnessEngine';
import { todayKey } from '@/screens/Onboarding/momentum';
import { listSubstanceEntries } from '@/db/queries/substances';
import { listCycleEntries } from '@/db/queries/cycle';
import { listMeditationSessions } from '@/db/queries/meditation';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { buildHealthAreas, type HealthAreaState } from '@/screens/HealthAreas/areas';

export type { HealthAreaState };

export function useHealthAreas(): {
  areas: HealthAreaState[];
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const metrics = useDailyMetrics();
  const metricsRef = useRef(metrics.data ?? null);
  metricsRef.current = metrics.data ?? null;

  const [areas, setAreas] = useState<HealthAreaState[]>(() =>
    buildHealthAreas({
      heartBpm: null,
      serverHeartBpm: null,
      loggedDays: 0,
      activeMedications: 0,
      documentCount: 0,
      substanceEntries: 0,
      cycleEntries: 0,
      profileWeightKg: null,
      activeDays7: 0,
      activitySessions7: 0,
      nutritionMeals7: 0,
      wellbeingDays7: 0,
      meditationSessions7: 0,
    }),
  );
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setAreas(
            buildHealthAreas({
              heartBpm: null,
              serverHeartBpm: null,
              loggedDays: 0,
              activeMedications: 0,
              documentCount: 0,
              substanceEntries: 0,
              cycleEntries: 0,
              profileWeightKg: null,
              activeDays7: 0,
              activitySessions7: 0,
              nutritionMeals7: 0,
              wellbeingDays7: 0,
              meditationSessions7: 0,
            }),
          );
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
      const [hrRows, logs, meds, docs, substance, cycle, profile, meditation] = await Promise.all([
        getRecentLocalHeartRates(patientId, 60).catch(() => []),
        getDailyLogs(patientId, 30).catch(() => []),
        getMedications(patientId).catch(() => []),
        getDocuments(patientId, { limit: 500 }).catch(() => []),
        listSubstanceEntries(patientId, 500).catch(() => []),
        listCycleEntries(patientId, 500).catch(() => []),
        getProfileCache(patientId).catch(() => ({ data: null })),
        listMeditationSessions(patientId, 500).catch(() => []),
      ]);
      if (!mounted.current) return;
      const serverHr = detectHeartRate(metricsRef.current);
      // Trailing-7-day tracked-action union (Discipline Engine contract):
      // one bounded dose range over indexes + rows already in memory.
      const hubToday = todayKey();
      const [hubRangeStart, hubRangeEnd] = trailingRangeIso(hubToday, 7);
      const hubTaken = await getTakenEventsInRange(patientId, hubRangeStart, hubRangeEnd).catch(
        () => [],
      );
      // Trailing-7-day logged activity sessions (Fitness Engine contract):
      // one bounded range over the group-date index.
      const hubWeekStart = fitnessWindowStart(hubToday, 7);
      const hubActivity = await getActivityLogs(
        patientId,
        hubWeekStart,
        hubToday,
      ).catch(() => []);
      // Trailing-7-day logged meal counts (Nutrition Engine contract):
      // summed from the daily-log rows already in memory.
      const hubNutritionMeals = logs
        .filter((l) => l.log_date.slice(0, 10) >= hubWeekStart)
        .reduce(
          (s, l) =>
            s +
            (typeof l.meals_count === 'number' && Number.isFinite(l.meals_count) ? l.meals_count : 0),
          0,
        );
      // Trailing-7-day days with a wellbeing rating (Wellbeing Engine
      // contract): counted from the daily-log rows already in memory.
      const hubWellbeingDays = logs.filter(
        (l) =>
          l.log_date.slice(0, 10) >= hubWeekStart &&
          (l.overall_wellbeing != null || l.energy_level != null || l.stress_level != null),
      ).length;
      if (!mounted.current) return;
      const meditationDays = meditation
        .filter((s) => s.completed === 1)
        .map((s) => String(s.started_at).slice(0, 10));
      const meditationSessions7 = meditation.filter(
        (s) =>
          s.completed === 1 && String(s.started_at).slice(0, 10) >= hubWeekStart,
      ).length;
      const hubActive = collectActiveDates({
        logDates: logs.map((l) => l.log_date),
        takenInstants: hubTaken.map((e) => e.taken_at),
        substanceDates: substance.map((e) => String(e.occurred_at).slice(0, 10)),
        cycleDates: cycle.map((e) => e.date),
        heartDates: hrRows.map((r) => r.measuredAt),
        meditationDates: meditationDays,
      });
      setAreas(
        buildHealthAreas({
          heartBpm: hrRows.length > 0 ? hrRows[0].bpm : null,
          serverHeartBpm: serverHr ? serverHr.value : null,
          loggedDays: logs.length,
          activeMedications: meds.filter((m) => m.status === 'ACTIVE').length,
          documentCount: docs.length,
          substanceEntries: substance.length,
          cycleEntries: cycle.length,
          profileWeightKg: profile.data?.weight_kg ?? null,
          activeDays7: countTrailingWeek(hubActive, hubToday),
          activitySessions7: hubActivity.length,
          nutritionMeals7: hubNutritionMeals,
          wellbeingDays7: hubWellbeingDays,
          meditationSessions7,
        }),
      );
      setIsLoading(false);
    } catch {
      if (mounted.current) setIsLoading(false);
    }
  }, [uid]);

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

  return { areas, isLoading, refetch };
}
