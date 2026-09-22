/**
 * useFitnessEngine — Fitness Engine data hook (Batch 6E).
 *
 * One bounded, patient-scoped read (trailing 28 days of ACTIVITY_LOG
 * events via the check-in group date) projected through the pure
 * fitnessEngine.ts contract. Refreshes on focus and on dataRefresh;
 * logged-out yields empty (the screen shows the honest empty state).
 * No polling, no N+1, no writes, no derived metrics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getActivityLogs } from '@/db/queries/dailyLogs';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  FITNESS_HISTORY_DAYS,
  buildFitnessWeek,
  describeMinutesChange,
  describeSessionsChange,
  fitnessWindowStart,
  priorWeekSessions,
  summarizeFitness,
  trailingWeekSessions,
  type FitnessSession,
  type FitnessSummary,
  type FitnessWeekDay,
} from '@/screens/FitnessEngine/fitnessEngine';

export function useFitnessEngine(): {
  sessions: FitnessSession[];
  summary: FitnessSummary;
  week: FitnessWeekDay[];
  sessionsLine: string | null;
  minutesLine: string | null;
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [sessions, setSessions] = useState<FitnessSession[]>([]);
  const [today, setToday] = useState(() => todayKey());
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setSessions([]);
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
      const rows = await getActivityLogs(
        patientId,
        fitnessWindowStart(now, FITNESS_HISTORY_DAYS),
        now,
      ).catch(() => []);
      if (!mounted.current) return;
      setToday(now);
      setSessions(
        rows.map((r) => ({
          date: r.log_date.slice(0, 10),
          type: r.activity_type,
          durationMinutes: r.duration_minutes,
          caloriesLogged: r.calories_burned,
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

  const summary = summarizeFitness(trailingWeekSessions(sessions, today));
  const current = trailingWeekSessions(sessions, today);
  const previous = priorWeekSessions(sessions, today);
  return {
    sessions,
    summary,
    week: buildFitnessWeek(sessions, today),
    sessionsLine: describeSessionsChange(current, previous),
    minutesLine: describeMinutesChange(current, previous),
    today,
    isLoading,
    refetch: load,
  };
}
