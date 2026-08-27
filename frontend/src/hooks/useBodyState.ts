import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { BodyStateItem } from '@/types';

export function useBodyState() {
  return useQuery<BodyStateItem[]>({
    queryKey: ['bodyState'],
    queryFn: () => api.get<BodyStateItem[]>('/api/v1/body-state'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}