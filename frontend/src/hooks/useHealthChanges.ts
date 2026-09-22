/**
 * useHealthChanges — quantified week-over-week descriptors from real rows.
 *
 * Buckets existing local queries (camera heart rows, daily logs, taken
 * doses, substance entries) into this-week vs last-week windows and renders
 * descriptive change lines via the pure changes.ts contract. Areas without
 * sufficient history get null (the card shows its absolute headline
 * instead) — never a fabricated percentage. Refreshes on focus and on
 * dataRefresh; logged-out yields all null.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getDailyLogs } from '@/db/queries/dailyLogs';
import { getMedicationTakenEventsForDate } from '@/db/queries/medicationTakenEvents';
import { getRecentLocalHeartRates } from '@/db/queries/heartRate';
import { listSubstanceEntries } from '@/db/queries/substances';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import {
  adherencePercent,
  describeChange,
  inWindow,
  summarize,
  weekWindows,
  type PeriodSummary,
} from '@/screens/HealthAreas/changes';
import type { HealthAreaId } from '@/screens/HealthAreas/areas';

export type AreaChangeLines = Partial<Record<HealthAreaId, string>>;

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function splitWeeks<T>(rows: ReadonlyArray<{ date: string; value: T }>, windows: {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
}): { current: T[]; previous: T[] } {
  const current: T[] = [];
  const previous: T[] = [];
  for (const r of rows) {
    if (inWindow(r.date, windows.currentStart, windows.currentEnd)) current.push(r.value);
    else if (inWindow(r.date, windows.previousStart, windows.previousEnd)) previous.push(r.value);
  }
  return { current, previous };
}

export function useHealthChanges(): {
  changes: AreaChangeLines;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [changes, setChanges] = useState<AreaChangeLines>({});
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      if (!uid) {
        if (mounted.current) {
          setChanges({});
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
      const windows = weekWindows(today);
      const label = 'vs last week';
      const [hrRows, logs, substance] = await Promise.all([
        getRecentLocalHeartRates(patientId, 90).catch(
          () => [] as Awaited<ReturnType<typeof getRecentLocalHeartRates>>,
        ),
        getDailyLogs(patientId, 30).catch(
          () => [] as Awaited<ReturnType<typeof getDailyLogs>>,
        ),
        listSubstanceEntries(patientId, 200).catch(
          () => [] as Awaited<ReturnType<typeof listSubstanceEntries>>,
        ),
      ]);
      const takenNested = await Promise.all(
        Array.from({ length: 14 }, (_, i) => shiftDayKey(today, -i)).map((date) =>
          getMedicationTakenEventsForDate(patientId, date)
            .then((events) => ({ date, events }))
            .catch(() => ({ date, events: [] as never[] })),
        ),
      );
      if (!mounted.current) return;

      const next: AreaChangeLines = {};

      // Heart: average BPM, absolute delta (percentages mislead here).
      const hrSplit = splitWeeks(
        hrRows.map((r) => ({ date: r.measuredAt.slice(0, 10), value: r.bpm })),
        windows,
      );
      const hrLine = describeChange({
        current: summarize(hrSplit.current),
        previous: summarize(hrSplit.previous),
        mode: 'average',
        unit: 'bpm',
        periodLabel: label,
        usePercent: false,
      });
      if (hrLine) next.heart = `Average HR ${hrLine}`;

      // Meals: logged meal counts, percentage when the baseline exists.
      const mealSplit = splitWeeks(
        logs
          .filter((l) => l.meals_count != null)
          .map((l) => ({ date: l.log_date.slice(0, 10), value: l.meals_count as number })),
        windows,
      );
      const mealLine = describeChange({
        current: summarize(mealSplit.current),
        previous: summarize(mealSplit.previous),
        mode: 'sum',
        unit: '',
        periodLabel: label,
      });
      if (mealLine) next.nutrition = `Meals ${mealLine}`;

      // Sleep: average minutes, absolute delta.
      const sleepSplit = splitWeeks(
        logs
          .filter((l) => l.sleep_duration_minutes != null)
          .map((l) => ({ date: l.log_date.slice(0, 10), value: l.sleep_duration_minutes as number })),
        windows,
      );
      const sleepLine = describeChange({
        current: summarize(sleepSplit.current),
        previous: summarize(sleepSplit.previous),
        mode: 'average',
        unit: 'min',
        periodLabel: label,
        usePercent: false,
      });
      if (sleepLine) next.sleep = `Average sleep ${sleepLine}`;

      // Adherence: trailing-7-day taken rate (single-period absolute).
      const weekStatuses: string[] = [];
      for (const { date, events } of takenNested) {
        if (inWindow(date, windows.currentStart, windows.currentEnd)) {
          for (const e of events) weekStatuses.push(e.status);
        }
      }
      const adherence = adherencePercent(weekStatuses);
      if (adherence) next.medications = adherence.text;

      // Substance: entry counts, percentage when the baseline exists.
      const subSplit = splitWeeks(
        substance.map((e) => ({ date: String(e.occurred_at).slice(0, 10), value: 1 })),
        windows,
      );
      const subLine = describeChange({
        current: summarize(subSplit.current),
        previous: summarize(subSplit.previous),
        mode: 'count',
        unit: '',
        periodLabel: label,
      });
      if (subLine) next.substance = `Entries ${subLine}`;

      setChanges(next);
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

  return { changes, isLoading, refetch };
}

export type { PeriodSummary };
