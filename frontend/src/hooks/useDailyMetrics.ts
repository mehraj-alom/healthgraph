import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface DailyMetrics {
  latest_vitals: Array<{ concept_id: string | null; display_name: string; value: number; unit: string; event_time: string }>;
  today_wellbeing: { overall_wellbeing: number; energy_level: number; stress_level: number; event_time: string } | null;
  latest_pain: { severity: number; pain_type: string | null; event_time: string } | null;
  latest_sleep: { duration_minutes: number; sleep_quality: number | null; awakenings: number | null; event_time: string } | null;
  recent_daily_logs: Array<{ log_date: string; event_count: number; categories: string[] }>;
}

export function useDailyMetrics() {
  return useQuery<DailyMetrics>({
    queryKey: ['daily-metrics'],
    queryFn: () => api.get<DailyMetrics>('/api/v1/daily-metrics'),
    staleTime: 60 * 1000,
  });
}
