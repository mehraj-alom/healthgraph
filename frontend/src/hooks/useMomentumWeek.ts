/**
 * useMomentumWeek — seven-day momentum from ACTUAL local rows only.
 *
 * Assembles daily-log dates, camera heart rates (both modalities via the
 * shared heartRate feed), and taken-dose counts, then shapes them with the
 * pure buildMomentumWeek model. No synthesis: empty data yields the honest
 * empty state. Refreshes on focus and on dataRefresh (a fresh log or
 * measurement updates the strip without polling).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getDailyLogs } from '@/db/queries/dailyLogs';
import {
  getRecentLocalHeartRates,
  toHeartDayPoints,
} from '@/db/queries/heartRate';
import { getMedicationTakenEventsForDate } from '@/db/queries/medicationTakenEvents';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import {
  buildMomentumWeek,
  isMomentumEmpty,
  momentumActiveDays,
  todayKey,
  type MomentumDay,
} from '@/screens/Onboarding/momentum';

export type { MomentumDay };

export interface UseMomentumWeek {
  days: MomentumDay[];
  isEmpty: boolean;
  activeDays: number;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useMomentumWeek(): UseMomentumWeek {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [days, setDays] = useState<MomentumDay[]>([]);
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
      const today = todayKey();
      const [logs, hrRows] = await Promise.all([
        getDailyLogs(patientId, 7),
        getRecentLocalHeartRates(patientId, 60),
      ]);
      const logDates = logs.map((l) => String(l.log_date).slice(0, 10));
      const hrByDate: Record<string, number> = {};
      for (const p of toHeartDayPoints(hrRows)) hrByDate[p.date] = p.value;
      const dosesByDay: Record<string, number> = {};
      await Promise.all(
        [0, 1, 2, 3, 4, 5, 6].map(async (back) => {
          const date = shiftDayKey(today, -back);
          try {
            const events = await getMedicationTakenEventsForDate(patientId, date);
            dosesByDay[date] = events.filter((e) => e.status === 'TAKEN').length;
          } catch {
            dosesByDay[date] = 0;
          }
        }),
      );
      if (!mounted.current) return;
      setDays(buildMomentumWeek(today, logDates, hrByDate, dosesByDay));
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

  return {
    days,
    isEmpty: days.length > 0 && isMomentumEmpty(days),
    activeDays: momentumActiveDays(days),
    isLoading,
    refetch,
  };
}
