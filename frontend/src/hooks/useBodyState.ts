import { useCallback } from 'react';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { api } from '@/services/api';
import { BodyStateItem } from '@/types';

export function useBodyState() {
  const queryFn = useCallback(() => api.get<BodyStateItem[]>('/api/v1/body-state'), []);
  
  const result = useCachedQuery<BodyStateItem[]>({
    cacheKey: 'bodyState',
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