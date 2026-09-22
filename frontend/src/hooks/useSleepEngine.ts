/**
 * useSleepEngine — Sleep Engine data hook (Batch 6B).
 *
 * One bounded, patient-scoped SQLite read (trailing 28 days of daily-log
 * sleep columns) projected through the pure sleepEngine.ts contract.
 * Refreshes on focus and on dataRefresh; logged-out yields empty (the
 * screen shows the connect/check-in empty state, never zeros). No polling,
 * no N+1, no sync writes — sleep rows are device check-ins (provenance
 * "on this device") that sync through the existing daily-log pipeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getSleepNights } from '@/db/queries/dailyLogs';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  SLEEP_HISTORY_DAYS,
  buildSleepWeek,
  describeSleepChange,
  sleepWindowStart,
  summarizeSleepNights,
  type SleepNight,
  type SleepSummary,
  type SleepWeekDay,
} from '@/screens/SleepEngine/sleepEngine';

export function useSleepEngine(): {
  nights: SleepNight[];
  summary: SleepSummary;
  week: SleepWeekDay[];
  changeLine: string | null;
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [nights, setNights] = useState<SleepNight[]>([]);
  const [today, setToday] = useState(() => todayKey());
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setNights([]);
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
      const rows = await getSleepNights(
        patientId,
        sleepWindowStart(now, SLEEP_HISTORY_DAYS),
        now,
      ).catch(() => []);
      if (!mounted.current) return;
      setToday(now);
      setNights(
        rows.map((r) => ({
          date: r.log_date.slice(0, 10),
          durationMinutes: r.sleep_duration_minutes,
          quality: r.sleep_quality,
          awakenings: r.sleep_awakenings,
        })),
      );
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

  const summary = summarizeSleepNights(nights);
  return {
    nights,
    summary,
    week: buildSleepWeek(nights, today),
    changeLine: describeSleepChange(nights, today),
    today,
    isLoading,
    refetch: load,
  };
}
