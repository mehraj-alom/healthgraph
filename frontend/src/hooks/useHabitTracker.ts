/**
 * useHabitTracker — GitHub-style activity counts from real tracked rows.
 *
 * Counts per local calendar day across check-ins, dose events, substance
 * + cycle entries, and camera measurements (the same tracked-action
 * union the Discipline Engine uses), bounded to the trailing 16 weeks +
 * a 7-day lookback for week alignment. Refreshes on focus and on
 * dataRefresh; logged-out yields empty. No writes, no estimates.
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
  HABIT_WEEKS,
  buildHabitWeeks,
  type HabitCell,
} from '@/screens/Settings/habitTracker';
import {
  collectActiveDates,
  currentActiveStreak,
  localDayKeyOfInstant,
} from '@/screens/DisciplineEngine/disciplineEngine';

const LOOKBACK_DAYS = HABIT_WEEKS * 7 + 7;

function windowStartIso(today: string, days: number): [string, string] {
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1);
  start.setDate(start.getDate() - (days - 1));
  return [start.toISOString(), new Date().toISOString()];
}

export function useHabitTracker(): {
  weeks: HabitCell[][];
  activeDays: number;
  totalActions: number;
  streakDays: number;
  isLoading: boolean;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [weeks, setWeeks] = useState<HabitCell[][]>([]);
  const [activeDays, setActiveDays] = useState(0);
  const [totalActions, setTotalActions] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setWeeks([]);
          setActiveDays(0);
          setTotalActions(0);
          setStreakDays(0);
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
      const [rangeStart, rangeEnd] = windowStartIso(now, LOOKBACK_DAYS);
      const [logs, taken, substance, cycle, heart] = await Promise.all([
        getDailyLogs(patientId, LOOKBACK_DAYS).catch(() => []),
        getTakenEventsInRange(patientId, rangeStart, rangeEnd).catch(() => []),
        listSubstanceEntries(patientId, 300).catch(() => []),
        listCycleEntries(patientId, 300).catch(() => []),
        getRecentLocalHeartRates(patientId, 200).catch(() => []),
      ]);
      if (!mounted.current) return;
      // Window floor (local day): unbounded lists (substance/cycle) must
      // not leak ancient entries into windowed totals.
      const [wy, wm, wd] = now.split('-').map(Number);
      const floor = new Date(wy, (wm ?? 1) - 1, wd ?? 1);
      floor.setDate(floor.getDate() - (LOOKBACK_DAYS - 1));
      const floorKey = `${floor.getFullYear()}-${String(floor.getMonth() + 1).padStart(2, '0')}-${String(floor.getDate()).padStart(2, '0')}`;
      const inWindow = (day: string | null): day is string =>
        day !== null && day >= floorKey && day <= now;
      // One count per logged date (duplicate group rows share a date).
      const seenLogDays = new Set<string>();
      const logDays: string[] = [];
      for (const l of logs) {
        const day = l.log_date.slice(0, 10);
        if (seenLogDays.has(day) || !inWindow(day)) continue;
        seenLogDays.add(day);
        logDays.push(day);
      }
      const takenDays = taken
        .map((e) => localDayKeyOfInstant(e.taken_at))
        .filter(inWindow);
      const subDays = substance.map((e) => String(e.occurred_at).slice(0, 10)).filter(inWindow);
      const cycDays = cycle.map((e) => e.date).filter(inWindow);
      const heartDays = heart.map((r) => r.measuredAt.slice(0, 10)).filter(inWindow);
      const counts = new Map<string, number>();
      for (const day of [...logDays, ...takenDays, ...subDays, ...cycDays, ...heartDays]) {
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      const active = collectActiveDates({
        logDates: logDays,
        takenInstants: takenDays.map((d) => `${d}T12:00:00`),
        substanceDates: subDays,
        cycleDates: cycDays,
        heartDates: heartDays,
      });
      let total = 0;
      for (const n of counts.values()) total += n;
      setWeeks(buildHabitWeeks(counts, now));
      setActiveDays(active.size);
      setTotalActions(total);
      setStreakDays(currentActiveStreak(active, now));
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

  return { weeks, activeDays, totalActions, streakDays, isLoading };
}
