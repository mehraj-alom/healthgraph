/**
 * useReadiness — overnight-recovery hint from device data (no writes).
 *
 * One bounded load per source (sleep nights, heart points, PPG rows,
 * activity logs over the trailing 28 days), projected through the pure
 * recovery.ts contract. Refreshes on focus and on dataRefresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getSleepNights } from '@/db/queries/dailyLogs';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { getActivityLogs } from '@/db/queries/dailyLogs';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  computeReadiness,
  type ActivityInput,
  type HrInput,
  type HrvInput,
  type Readiness,
  type SleepInput,
} from '@/screens/Recovery/recovery';

const WINDOW_DAYS = 28;
const FEED_LIMIT = 500;

function windowStart(today: string): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - (WINDOW_DAYS - 1));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useReadiness(): {
  readiness: Readiness | null;
  missing: string[];
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [result, setResult] = useState<{ readiness: Readiness | null; missing: string[] }>({
    readiness: null,
    missing: [],
  });
  const [today, setToday] = useState(() => todayKey());
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setResult({ readiness: null, missing: [] });
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
      const start = windowStart(now);
      const [sleepRows, hrRows, ppgRows, activityRows] = await Promise.all([
        getSleepNights(patientId, start, now).catch(() => []),
        getRecentLocalHeartRates(patientId, FEED_LIMIT).catch(() => []),
        getRecentPpgMeasurements(patientId, FEED_LIMIT).catch(() => []),
        getActivityLogs(patientId, start, now).catch(() => []),
      ]);
      if (!mounted.current) return;
      const nights: SleepInput[] = sleepRows.map((r) => ({
        date: r.log_date.slice(0, 10),
        durationMinutes: r.sleep_duration_minutes,
        quality: r.sleep_quality,
      }));
      const hr: HrInput[] = [];
      for (const r of hrRows) {
        if ((r as { reliable?: number }).reliable === 1 && Number.isFinite((r as { bpm?: number }).bpm)) {
          hr.push({ measuredAt: String((r as { measuredAt?: string }).measuredAt), bpm: (r as { bpm?: number }).bpm as number });
        }
      }
      for (const r of ppgRows) {
        const bpm = (r as { heart_rate_bpm?: number }).heart_rate_bpm;
        if (Number.isFinite(bpm) && (bpm as number) > 0) {
          hr.push({ measuredAt: String((r as { measured_at?: string }).measured_at), bpm: bpm as number });
        }
      }
      const hrv: HrvInput[] = [];
      for (const r of ppgRows) {
        const v = (r as { rmssd_ms?: number }).rmssd_ms;
        if (Number.isFinite(v) && (v as number) > 0) {
          hrv.push({ measuredAt: String((r as { measured_at?: string }).measured_at), rmssdMs: v as number });
        }
      }
      const activity: ActivityInput[] = activityRows.map((a) => ({
        log_date: a.log_date.slice(0, 10),
        duration_minutes: a.duration_minutes,
      }));
      setToday(now);
      setResult(computeReadiness({ nights, hr, hrv, activity }, now));
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

  return { ...result, today, isLoading, refetch: load };
}
