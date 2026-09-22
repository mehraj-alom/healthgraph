/**
 * useNutritionEngine — Nutrition Engine data hook (Batch 6F).
 *
 * One bounded, patient-scoped read (trailing 28 days of group-level meal
 * columns) projected through the pure nutritionEngine.ts contract.
 * Refreshes on focus and on dataRefresh; logged-out yields empty (the
 * screen shows the honest empty state). No polling, no N+1, no writes,
 * no derived metrics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@/context/AuthContext';
import { getCachedPatientId } from '@/services/patientIdentity';
import { waitForIdentityReady } from '@/services/backendIdentity';
import { getNutritionDays } from '@/db/queries/dailyLogs';
import { subscribeDataRefresh } from '@/services/dataRefresh';
import { todayKey } from '@/screens/Onboarding/momentum';
import {
  NUTRITION_HISTORY_DAYS,
  buildNutritionWeek,
  describeKcalChange,
  describeMealsChange,
  nutritionWindowStart,
  parseMealTypes,
  priorWeekDays,
  summarizeNutrition,
  trailingWeekDays,
  type NutritionDay,
  type NutritionSummary,
  type NutritionWeekDay,
} from '@/screens/NutritionEngine/nutritionEngine';

export function useNutritionEngine(): {
  days: NutritionDay[];
  summary: NutritionSummary;
  week: NutritionWeekDay[];
  mealsLine: string | null;
  kcalLine: string | null;
  typeCounts: { type: string; count: number }[];
  classifiedMeals: number;
  today: string;
  isLoading: boolean;
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [days, setDays] = useState<NutritionDay[]>([]);
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
      const rows = await getNutritionDays(
        patientId,
        nutritionWindowStart(now, NUTRITION_HISTORY_DAYS),
        now,
      ).catch(() => []);
      if (!mounted.current) return;
      setToday(now);
      setDays(
        rows.map((r) => ({
          date: r.log_date.slice(0, 10),
          meals: r.meals_count,
          kcal: r.calories_kcal,
          label: r.food_label,
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

  const current = trailingWeekDays(days, today);
  const previous = priorWeekDays(days, today);
  const parsed = parseMealTypes(current);
  return {
    days,
    summary: summarizeNutrition(current),
    week: buildNutritionWeek(days, today),
    mealsLine: describeMealsChange(current, previous),
    kcalLine: describeKcalChange(current, previous),
    typeCounts: Object.entries(parsed.byType).map(([type, count]) => ({
      type,
      count: count ?? 0,
    })),
    classifiedMeals: parsed.classified,
    today,
    isLoading,
    refetch: load,
  };
}
