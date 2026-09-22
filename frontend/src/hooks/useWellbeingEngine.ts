/**
 * useWellbeingEngine — Wellbeing Engine data hook (Batch 6G).
 *
 * One bounded, patient-scoped read (trailing 28 days of group-level
 * 1–5 ratings) projected through the pure wellbeingEngine.ts contract.
 * Refreshes on focus and on dataRefresh; logged-out yields empty (the
 * screen shows the honest empty state). No polling, no N+1, no writes,
 * no derived metrics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getWellbeingDays } from '@/db/queries/dailyLogs';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  WELLBEING_HISTORY_DAYS,
  describeRatingChange,
  priorWeekWellbeing,
  summarizeWellbeing,
  trailingWeekWellbeing,
  wellbeingWindowStart,
  type WellbeingDay,
  type WellbeingSummary,
} from '@/screens/WellbeingEngine/wellbeingEngine';

export function useWellbeingEngine(): {
  days: WellbeingDay[];
  summary: WellbeingSummary;
  moodLine: string | null;
  energyLine: string | null;
  stressLine: string | null;
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [days, setDays] = useState<WellbeingDay[]>([]);
  const [today, setToday] = useState(() => todayKey());
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setDays([]);
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
      const rows = await getWellbeingDays(
        patientId,
        wellbeingWindowStart(now, WELLBEING_HISTORY_DAYS),
        now,
      ).catch(() => []);
      if (!mounted.current) return;
      setToday(now);
      setDays(
        rows.map((r) => ({
          date: r.log_date.slice(0, 10),
          mood: r.overall_wellbeing,
          energy: r.energy_level,
          stress: r.stress_level,
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

  const current = trailingWeekWellbeing(days, today);
  const previous = priorWeekWellbeing(days, today);
  return {
    days,
    summary: summarizeWellbeing(current),
    moodLine: describeRatingChange('mood', current, previous),
    energyLine: describeRatingChange('energy', current, previous),
    stressLine: describeRatingChange('stress', current, previous),
    today,
    isLoading,
    refetch: load,
  };
}
