import { useCallback } from 'react';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { api } from '@/services/api';
import type { TrendsResponse } from '@/types';

function normalizeCorrelation(value: TrendsResponse['sleep_energy_correlation'] | null | undefined): TrendsResponse['sleep_energy_correlation'] {
  return {
    paired_count: value?.paired_count ?? 0,
    r: value?.r ?? null,
    strength: value?.strength ?? 'insufficient_data',
    description: value?.description ?? 'Not enough paired data to assess this relationship.',
  };
}

function normalizeTrendsResponse(response: Partial<TrendsResponse> | null | undefined): TrendsResponse {
  return {
    ...(response ?? {}),
    period_days: response?.period_days ?? 30,
    logged_days: response?.logged_days ?? 0,
    wellbeing_points: response?.wellbeing_points ?? [],
    avg_wellbeing: response?.avg_wellbeing ?? null,
    avg_energy: response?.avg_energy ?? null,
    avg_stress: response?.avg_stress ?? null,
    wellbeing_trend: response?.wellbeing_trend ?? { direction: 'insufficient_data', label: 'Not enough data yet' },
    sleep_points: response?.sleep_points ?? [],
    avg_sleep_minutes: response?.avg_sleep_minutes ?? null,
    min_sleep_minutes: response?.min_sleep_minutes ?? null,
    max_sleep_minutes: response?.max_sleep_minutes ?? null,
    avg_sleep_quality: response?.avg_sleep_quality ?? null,
    sleep_trend: response?.sleep_trend ?? { direction: 'insufficient_data', label: 'Not enough data yet' },
    sleep_energy_scatter: response?.sleep_energy_scatter ?? [],
    sleep_energy_correlation: normalizeCorrelation(response?.sleep_energy_correlation),
    sleep_stress_scatter: response?.sleep_stress_scatter ?? [],
    sleep_stress_correlation: normalizeCorrelation(response?.sleep_stress_correlation),
    symptom_summaries: response?.symptom_summaries ?? [],
    symptom_time_series: response?.symptom_time_series ?? [],
    available_symptoms: response?.available_symptoms ?? [],
    documents_processed: response?.documents_processed ?? 0,
    clinical_events_extracted: response?.clinical_events_extracted ?? 0,
    medical_record_activity: response?.medical_record_activity ?? [],
    insights: response?.insights ?? [],
  };
}

export function useTrends(days: number = 30) {
  const queryFn = useCallback(
    () => api.get<TrendsResponse>(`/api/v1/trends?days=${days}`).then(normalizeTrendsResponse),
    [days],
  );
  
  const result = useCachedQuery<TrendsResponse>({
    cacheKey: 'trends',
    cacheDays: days,
    queryFn,
  });

  return {
    data: result.data,
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}
