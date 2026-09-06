import { useCallback } from 'react';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { api } from '@/services/api';
import type { Medication, MedicationTakenEvent, ActiveMedicationForDailyLog, DailyMedicationSchedule } from '@/types';

export function useMedications(status?: string) {
  const queryFn = useCallback(
    () => api.get<{ medications: Medication[]; total: number }>(`/api/v1/medications${status ? `?status=${status}` : ''}`),
    [status],
  );

  const result = useCachedQuery<{ medications: Medication[]; total: number }>({
    cacheKey: 'medications',
    queryFn,
  });

  return {
    data: result.data?.medications ?? [],
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}

export function useActiveMedications() {
  const queryFn = useCallback(
    () => api.get<ActiveMedicationForDailyLog[]>('/api/v1/medications/active'),
    [],
  );

  const result = useCachedQuery<ActiveMedicationForDailyLog[]>({
    cacheKey: 'medications',
    queryFn,
  });

  return {
    data: result.data ?? [],
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}

export function useMedicationSchedule(targetDate: string) {
  const queryFn = useCallback(
    () => api.get<DailyMedicationSchedule[]>(`/api/v1/medications/schedule/${targetDate}`),
    [targetDate],
  );

  const result = useCachedQuery<DailyMedicationSchedule[]>({
    cacheKey: 'medications',
    queryFn,
  });

  return {
    data: result.data ?? [],
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}

export function useMedicationTakenEvents(medicationId: string) {
  const queryFn = useCallback(
    () => api.get<{ events: MedicationTakenEvent[]; total: number }>(`/api/v1/medications/${medicationId}/taken`),
    [medicationId],
  );

  const result = useCachedQuery<{ events: MedicationTakenEvent[]; total: number }>({
    cacheKey: 'medications',
    queryFn,
  });

  return {
    data: result.data?.events ?? [],
    isLoading: result.isLoading,
    isRefreshing: result.isRefreshing,
    error: result.error,
    refetch: result.refetch,
    isFromCache: result.isFromCache,
  };
}