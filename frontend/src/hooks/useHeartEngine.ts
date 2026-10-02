/**
 * useHeartEngine — Heart Engine data hook (Batch 6H).
 *
 * Reuses the canonical local heart-rate query path (the same unified
 * feed the dial and hub consume — no second storage/query system) plus
 * the existing PPG history query for HRV rows. Bounded parallel reads,
 * patient-scoped; refreshes on focus and on dataRefresh; logged-out
 * yields empty (the screen shows the honest empty state). No polling,
 * no writes, no derived metrics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { getRecentPpgMeasurements } from '@/db/queries/ppg';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  HEART_FEED_LIMIT,
  describeHeartChange,
  latestHeartPoint,
  priorMonthHeart,
  priorWeekHeart,
  summarizeHeart,
  summarizeHrv,
  trailingMonthHeart,
  trailingWeekHeart,
  type HeartPoint,
  type HeartSummary,
  type HrvSummary,
} from '@/screens/HeartEngine/heartEngine';

export function useHeartEngine(): {
  latest: HeartPoint | null;
  summary: HeartSummary;
  changeLine: string | null;
  monthSummary: HeartSummary;
  monthChangeLine: string | null;
  recent: HeartPoint[];
  monthPoints: HeartPoint[];
  hrv: HrvSummary;
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [points, setPoints] = useState<HeartPoint[]>([]);
  const [hrvPoints, setHrvPoints] = useState<
    { measuredAt: string; rmssdMs: number; sdnnMs: number | null }[]
  >([]);
  const [today, setToday] = useState(() => todayKey());
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setPoints([]);
          setHrvPoints([]);
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
      const [feed, ppgRows] = await Promise.all([
        getRecentLocalHeartRates(patientId, HEART_FEED_LIMIT).catch(() => []),
        getRecentPpgMeasurements(patientId, HEART_FEED_LIMIT).catch(() => []),
      ]);
      if (!mounted.current) return;
      setToday(now);
      setPoints(
        feed.map((r) => ({
          measuredAt: r.measuredAt,
          bpm: r.bpm,
          method: r.method,
          signalQuality: r.signalQuality,
          reliable: r.reliable,
        })),
      );
      setHrvPoints(
        ppgRows.flatMap((r) =>
          typeof r.rmssd_ms === 'number' && Number.isFinite(r.rmssd_ms)
            ? [
                {
                  measuredAt: String(r.measured_at),
                  rmssdMs: r.rmssd_ms,
                  sdnnMs:
                    typeof r.sdnn_ms === 'number' && Number.isFinite(r.sdnn_ms)
                      ? r.sdnn_ms
                      : null,
                },
              ]
            : [],
        ),
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

  const current = trailingWeekHeart(points, today);
  const previous = priorWeekHeart(points, today);
  const monthCurrent = trailingMonthHeart(points, today);
  const monthPrevious = priorMonthHeart(points, today);
  const recent = [...points]
    .sort((a, b) => (a.measuredAt < b.measuredAt ? 1 : a.measuredAt > b.measuredAt ? -1 : 0))
    .slice(0, 14);
  const monthPoints = [...monthCurrent].sort((a, b) =>
    a.measuredAt < b.measuredAt ? -1 : a.measuredAt > b.measuredAt ? 1 : 0,
  );
  return {
    latest: latestHeartPoint(points),
    summary: summarizeHeart(current),
    changeLine: describeHeartChange(current, previous),
    monthSummary: summarizeHeart(monthCurrent),
    monthChangeLine: describeHeartChange(monthCurrent, monthPrevious, 'vs prior 30 days'),
    recent,
    monthPoints,
    hrv: summarizeHrv(hrvPoints),
    today,
    isLoading,
    refetch: load,
  };
}
