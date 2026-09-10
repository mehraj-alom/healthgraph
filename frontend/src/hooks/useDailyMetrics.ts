import { useCallback } from 'react';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { api } from '@/services/api';

export interface DailyMetrics {
  latest_vitals: Array<{ concept_id: string | null; display_name: string; value: number | null; unit: string | null; event_time: string }>;
  today_wellbeing: { overall_wellbeing: number | null; energy_level: number | null; stress_level: number | null; event_time: string } | null;
  latest_pain: { severity: number; pain_type: string | null; event_time: string } | null;
  latest_sleep: { duration_minutes: number; sleep_quality: number | null; awakenings: number | null; event_time: string } | null;
  today_activity: { duration_minutes: number; calories_burned: number | null; activity_count: number; event_time: string } | null;
  recent_daily_logs: Array<{ log_date: string; event_count: number; categories: string[] }>;
}

export function useDailyMetrics() {
  const queryFn = useCallback(() => api.get<DailyMetrics>('/api/v1/daily-metrics'), []);
  
  const result = useCachedQuery<DailyMetrics>({
    cacheKey: 'dailyMetrics',
    queryFn,
  });

  return {
    data: result.data,
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    isError: result.isError,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}
